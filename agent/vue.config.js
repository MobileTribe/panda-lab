module.exports = {
    pluginOptions: {
        electronBuilder: {
            chainWebpackMainProcess: config => {
                //Fix firebase log message
                config.resolve.mainFields.delete('main').prepend('main')
            },
            chainWebpackRendererProcess: config => {
                // Chain webpack config for electron renderer process only
                // The following example will set IS_ELECTRON to true in your app
                // config.plugin('define').tap(args => {
                //     args[0]['IS_ELECTRON'] = true
                //     return args
                // })
            },
            //disableMainProcessTypescript: false, // Manually disable typescript plugin for main process. Enable if you want to use regular js for the main process (src/background.js by default).
            //mainProcessTypeChecking: false // Manually enable type checking during webpck bundling for background file.

        }
    }
};