const fs = require('fs')
const path = require('path')
const MFS = require('memory-fs')
const webpack = require('webpack')
const chokidar = require('chokidar')
const clientConfig = require('./webpack.client.config')
const serverConfig = require('./webpack.server.config')
const errorConfig = require('./webpack.error.config')

// Read file in real or virtual file systems
const readFile = (fs, file) => {
  try {
    return fs.readFileSync(path.join(clientConfig.output.path, file), 'utf-8')
  } catch (e) {}
}

module.exports = function setupDevServer ({ server, templatePath, onUpdate }) {
  return new Promise((resolve, reject) => {
    let serverBundle
    let errorBundle
    let template
    let clientManifest

    const update = () => {
      if (serverBundle && errorBundle && clientManifest) {
        resolve()
        onUpdate({
          serverBundle,
          errorBundle,
        }, {
          template,
          clientManifest,
        })
      }
    }

    // read template from disk and watch
    template = fs.readFileSync(templatePath, 'utf-8')
    chokidar.watch(templatePath).on('change', () => {
      template = fs.readFileSync(templatePath, 'utf-8')
      console.log('index.html template updated.')
      update()
    })

    // modify client config to work with hot middleware
    clientConfig.entry = ['webpack-hot-middleware/client', clientConfig.entry]
    clientConfig.output.filename = '[name].js'
    clientConfig.plugins.push(
      new webpack.HotModuleReplacementPlugin(),
      new webpack.NoEmitOnErrorsPlugin()
    )

    // dev middleware
    const clientCompiler = webpack(clientConfig)
    const devMiddleware = require('webpack-dev-middleware')(clientCompiler, {
      publicPath: clientConfig.output.publicPath,
      noInfo: true,
    })
    server.use(devMiddleware)
    clientCompiler.plugin('done', stats => {
      stats = stats.toJson()
      stats.errors.forEach(err => console.error(err))
      stats.warnings.forEach(err => console.warn(err))
      if (stats.errors.length) return
      clientManifest = JSON.parse(readFile(
        devMiddleware.fileSystem,
        'vue-ssr-client-manifest.json'
      ))
      update()
    })

    // hot module replacement middleware
    server.use(require('webpack-hot-middleware')(clientCompiler, { heartbeat: 5000 }))

    // watch and update server renderer
    const serverCompiler = webpack(serverConfig)
    const serverMfs = new MFS()
    serverCompiler.outputFileSystem = serverMfs
    serverCompiler.watch({}, (err, stats) => {
      if (err) throw err
      stats = stats.toJson()
      if (stats.errors.length) return

      // read bundle generated by vue-ssr-webpack-plugin
      serverBundle = JSON.parse(readFile(serverMfs, 'vue-ssr-server-bundle.json'))
      update()
    })

    // Server error app
    const errorCompiler = webpack(errorConfig)
    const errorMfs = new MFS()
    errorCompiler.outputFileSystem = errorMfs
    errorCompiler.watch({}, (err, stats) => {
      if (err) throw err
      stats = stats.toJson()
      if (stats.errors.length) return

      // read bundle generated by vue-ssr-webpack-plugin
      errorBundle = JSON.parse(readFile(errorMfs, 'vue-ssr-error-bundle.json'))
      update()
    })
  })
}
