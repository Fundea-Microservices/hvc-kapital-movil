const { withMainApplication } = require('@expo/config-plugins');

module.exports = function withCleanJSI(config) {
  return withMainApplication(config, (config) => {
    let content = config.modResults.contents;

    // 1. DESTRUIR LA FUNCIÓN COMPLETA PRIMERO
    // Busca "override fun getJSIModulePackage" y borra todo hasta su llave de cierre "}"
    content = content.replace(/override\s+fun\s+getJSIModulePackage[\s\S]*?\}/g, '');

    // 2. DESTRUIR LAS IMPORTACIONES HUÉRFANAS (Línea por línea completa)
    // El modificador 'gm' (global, multiline) asegura que borre la línea entera sin dejar errores de sintaxis
    content = content.replace(/^.*import.*JSIModulePackage.*$/gm, '');
    content = content.replace(/^.*import.*WatermelonDBJSIPackage.*$/gm, '');
    content = content.replace(/^.*import.*ReanimatedJSIModulePackage.*$/gm, '');

    config.modResults.contents = content;
    return config;
  });
};