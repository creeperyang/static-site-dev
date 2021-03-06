'use strict';

const resolve = require('path').resolve;
const autoprefixer = require('autoprefixer');
const webpack = require('webpack');
const HtmlwebpackPlugin = require('html-webpack-plugin');
const ExtractTextPlugin = require('extract-text-webpack-plugin');
const config = require('../config');
const util = require('./util');
let APP_PATH = config.viewer.source;
const BUILD_PATH = config.viewer.dest;

// APP_PATH may be symbol link, fix it
try {
    APP_PATH = util.readlinkSync(APP_PATH);
} catch (e) {}

const plugins = [
    new webpack.DefinePlugin({
        'process.env':{
            'NODE_ENV': JSON.stringify('production')
        }
    }),
    new webpack.optimize.UglifyJsPlugin({
        minimize: true,
        compress:{
            warnings: false
        },
        sourceMap: false // prevent possible source map error
    }),
    new webpack.optimize.CommonsChunkPlugin('vendors', `scripts/vendors.js`),
    new HtmlwebpackPlugin({
        title: '模块查看器',
        filename: 'index.html',
        inject: 'body',
        template: resolve(APP_PATH, 'index.html')
    }),
    new ExtractTextPlugin(`styles/[name].[hash:5].css`, {
        allChunks: true
    }),
    new webpack.optimize.OccurenceOrderPlugin(),
    new webpack.NoErrorsPlugin()
];
const sassLoader = ExtractTextPlugin.extract('style-loader', [
    'css-loader?modules&localIdentName=[hash:base64:5]',
    'postcss-loader',
    'sass-loader?' + ['outputStyle=expanded', 'includePaths[]=' + APP_PATH].join('&')
].join('!'));
const cssLoader = ExtractTextPlugin.extract('style-loader', [
    'css-loader?modules&localIdentName=[hash:base64:5]',
    'postcss-loader'
].join('!'));
const loaders = [
    {
        test: /inject.scss$/i,
        loader: 'css-content!css!postcss-loader!sass-loader'
    }, {
        test: /app\/styles\/\S+\.scss$/,
        loader: sassLoader.replace(/!css-loader[^!]+!/, '!css-loader?sourceMap&-modules!')
    }, {
        test: /\.css$/,
        loader: cssLoader,
        include: APP_PATH
    }, {
        test: /\.scss$/,
        exclude: [/app\/styles\/\S+\.scss$/, /inject.scss$/i],
        loader: sassLoader
    }, {
        test: /\.jsx?$/,
        loader: 'babel',
        include: [APP_PATH],
        exclude: /(node_modules|bower_components)/,
        query: {
            // presets: ['es2015', 'stage-0', 'react']
            presets: [
                require.resolve('babel-preset-es2015'),
                require.resolve('babel-preset-react'),
                require.resolve('babel-preset-stage-0'),
            ]
        }
    }, {
        test: /\.woff$/,
        loader: `url?name=res/[name].[ext]&limit=10000&mimetype=application/font-woff`
    }, {
        test: /\.woff2$/,
        loader: `url?name=res/[name].[ext]&limit=10000&mimetype=application/font-woff`
    }, {
        test: /\.ttf$/,
        loader: `url?name=res/[name].[ext]&limit=10000&mimetype=application/octet-stream`
    }, {
        test: /\.eot$/,
        loader: `file?name=res/[name].[ext]`
    }, {
        test: /\.svg$/,
        loader: `url?name=res/[name].[ext]&limit=10000&mimetype=image/svg+xml`
    }, {
        test: /\.jpe?g$|\.gif$|\.png$|\.ico$/,
        loader: [`url-loader?name=images/[name].[ext]&limit=1024`].join('!')
    }
];

const webpackConfig = {
    entry: {
        app: resolve(APP_PATH, 'app.js'),
        vendors: ['react', 'react-dom', 'react-router']
    },
    output: {
        path: BUILD_PATH,
        // workround for load image correctly in browser.
        // see <https://github.com/webpack/style-loader/issues/55> for detail
        publicPath: `http://${config.server.host}:${config.server.port}/${config.viewer.prefix}/`,
        filename: `scripts/[name].[hash:5].js`,
        chunkFilename: `scripts/[id].bundle.js`
    },
    devtool: false,
    resolve: {
        fallback: [config.modulesRoot]
    },
    resolveLoader: {
        root: config.modulesRoot
    },
    plugins,
    target: 'web',
    module: {
        loaders
    },
    postcss: [autoprefixer({
        browsers: ['last 2 versions']
    })]
};

module.exports = webpackConfig;
