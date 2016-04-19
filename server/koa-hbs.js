'use strict';

const path = require('path');
const Handlebars = require('handlebars');

const util = require('./util');

const genPartialInfoComment = (name, filepath, hash) => {
    const options = {
        path: 'absolute', // 'absolute'|'relative'|false
        status: 'show' // 'show'|'hide'
    };
    if (hash && hash.length) {
        hash.some(v => {
            if (v.key === '$$info') {
                let val = util.parseString(v.value.value);
                util.merge(options, val);
                return true;
            }
        });
    }
    if (options.status === 'hide') {
        return null;
    }
    return {
        start: `<!-- partialBegin#${name} ${
            options.path === 'absolute' ? filepath : ''
        } -->\n`,
        end: `\n<!-- partialEnd#${name} -->\n`
    };
};

class ImportScanner extends Handlebars.Visitor {
    constructor() {
        super();
        this.reset();
    }
    reset() {
        this.partials = [];
        this.helpers = [];
    }
    BlockStatement(block) {
        this.helpers.push({
            name: block.path.original
        });
        super.BlockStatement(block);
    }
    PartialStatement(partial) {
        this.partials.push({
            name: partial.name.original,
            hash: partial.hash && partial.hash.pairs
        });
        super.PartialStatement(partial);
    }
}

class Hbs {
    constructor(opts) {
        let options = this.options = util.merge({}, Hbs.defaults, opts);
        if (!options.viewPath) {
            throw new Error('viewPath is required.');
        }
        this.scanner = new ImportScanner();
        this.handlebars = Handlebars.create();
        this.cache = {
            __default_layout__: {
                compiled: this.handlebars.compile('{{{body}}}')
            }
        };
        options.layoutPath = options.layoutPath || options.viewPath;
        // preinstall preInstalledHelpers
        this.installHelper('preInstalledHelpers');
    }
    parse(input, options) {
        const scanner = this.scanner;
        let ast = this.handlebars.parse(input, options);
        scanner.accept(ast);
        let partials = scanner.partials.filter((v) => {
            return !this.handlebars.partials[v.name];
        });
        let helpers = scanner.helpers.filter((v) => {
            return !this.handlebars.helpers[v.name];
        });
        scanner.reset();
        return {
            ast,
            partials,
            helpers
        };
    }
    registerHelper() {
        return this.handlebars.registerHelper.apply(this.handlebars, arguments);
    }
    unregisterHelper(name) {
        return this.handlebars.unregisterHelper(name);
    }
    registerPartial() {
        return this.handlebars.registerPartial.apply(this.handlebars, arguments);
    }
    unregisterPartial(name) {
        return this.handlebars.unregisterPartial(name);
    }
    // lookup view path
    fixPath(name, type, ext) {
        type = type || 'view';
        name = path.extname(name) ? name : (name + (ext || this.options.extname));
        if (path.isAbsolute(name)) {
            return name;
        }
        return path.resolve(this.options[type + 'Path'], name);
    }
    installPartial(name, hash) {
        const filepath = this.fixPath(name, 'partial');
        return util.read(filepath)
            .then(data => {
                // check params and dispaly partial info with comment
                const comment = genPartialInfoComment(name, filepath, hash);
                this.registerPartial(name, !comment ? data :
                    (comment.start + data + comment.end));
                return this.compile(data, true);
            });
    }
    installHelper(name) {
        return this.registerHelper(require(this.fixPath(name, 'helper', '.js')));
    }
    loadData(name) {
        const url = this.fixPath(name, 'data', '.json');
        if (!this.options.disableCache && this.cache[url] && this.cache[url].result) {
            return Promise.resolve(this.cache[url].result);
        }
        return util.read(url)
            .then(json => {
                return (this.cache[url] = {
                    result: JSON.parse(json)
                });
            });
    }
    /**
     * render template combined with data
     * @param  {String} name name of template, always the file name
     * @param  {Object} data data
     * @return {Promise}     promise
     */
    render(name, data) {
        const path = this.fixPath(name, 'view');
        const cache = this.cache;
        let promises;
        return this.resolve(path, (rawTpl) => {
            let parsed = util.parseYaml(rawTpl);
            let metadata = parsed.metadata;
            let layout, dataPath;
            if (metadata) {
                layout = metadata.layout;
                dataPath = metadata.data;
            }
            // load layout
            if (layout == null || layout === true) {
                layout = this.options.defaultLayout;
            } else if (!layout || typeof layout !== 'string') {
                layout = '__default_layout__';
            }
            promises = [];
            // always prevent to fixPath of '__default_layout__'
            // and load the file '__default_layout__.extname'
            // just load the compiled cache and prevent possible error
            promises.push(layout === '__default_layout__' ? this.cache['__default_layout__'].compiled :
                this.resolve(this.fixPath(layout, 'layout')));
            promises.push(dataPath ? this.loadData(dataPath) : null);
            promises.push(metadata);
            return parsed.content;
        }).then((tplFn) => {
            // if no promises, means tplFn is from cache[path].compiled,
            // and cache[path].result must exists,
            // so just use cache and no need to generate again
            return promises ? Promise.all(promises).then((res) => {
                util.merge(data, res[1], res[2]);
                data.body = tplFn(data);
                cache[path].result = res[0](data);
                return cache[path].result;
            }) : cache[path].result;
        });
    }
    /**
     * load content of file and compile it to render function
     * @param  {String} path         full path of file, prefer view/layout
     * @param  {Function} processTpl process the raw tpl and return handled content
     * @return {Promise}             promise
     */
    resolve(path, processTpl) {
        const cache = this.cache;
        if (!this.options.disableCache && cache[path] && cache[path].compiled) {
            return Promise.resolve(cache[path].compiled);
        }
        return util.read(path).then(rawTpl => {
            return this.compile(processTpl ? processTpl(rawTpl) : rawTpl);
        }).then((res) => {
            cache[path] = {
                compiled: res
            };
            return res;
        });
    }
    /**
     * compile raw template to render function
     * @param  {String} content          the content of template
     * @param  {Boolean} onlyResolveDeps only resolve dependencies and dont compile the template,
     *                                   inner usage only.
     * @return {Promise}                 promise
     */
    compile(content, onlyResolveDeps) {
        const result = this.parse(content);
        let partialsPromise;
        // load unregistered helpers -- sync
        if (result.helpers.length) {
            result.helpers.forEach((v) => {
                this.installHelper(v.name);
            });
        }
        // load unregistered partials -- async
        if (result.partials.length) {
            partialsPromise = Promise.all(result.partials.map((v) => {
                return this.installPartial(v.name, v.hash);
            }));
        }
        const promise = Promise.resolve(partialsPromise);
        return onlyResolveDeps ? promise : promise.then(() => {
            return this.handlebars.compile(result.ast, this.options.templateOptions);
        });
    }
}

Hbs.defaults = {
    templateOptions: {},
    // default disable cache, so it will always reload file
    // and thus all change will be present
    disableCache: true,
    extname: '.hbs',
    defaultLayout: 'default'
};

const createRenderer = (hbs) => {
    // assume this is bind to koa instance
    return function(name, locals) {
        locals = locals || {};
        util.merge(locals, this.state, hbs.locals);
        return hbs.render(name, locals).then((html) => {
            this.body = html;
        });
    };
};

exports = module.exports = (options) => {
    const hbs = new Hbs(options);
    const render = createRenderer(hbs);
    return (ctx, next) => {
        ctx.render = render;
        return next();
    };
};

exports.Hbs = Hbs;
