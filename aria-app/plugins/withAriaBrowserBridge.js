const { withAndroidManifest } = require('@expo/config-plugins');

const SERVICE_NAME = '.aria.browser.AriaAccessibilityService';
const SERVICE_XML = '@xml/aria_accessibility_service';

module.exports = function withAriaBrowserBridge(config) {
  return withAndroidManifest(config, config => {
    const manifest = config.modResults.manifest;
    const application = manifest.application?.[0];
    if (!application) throw new Error('ARIA_BROWSER_BRIDGE: Android application node missing');

    application.service = application.service || [];
    const exists = application.service.some(s => s.$?.['android:name'] === SERVICE_NAME);
    if (!exists) {
      application.service.push({
        $: {
          'android:name': SERVICE_NAME,
          'android:permission': 'android.permission.BIND_ACCESSIBILITY_SERVICE',
          'android:exported': 'false',
          'android:label': 'ARIA Browser Bridge',
          'android:description': 'Controlled browser interface for ARIA Computer Use'
        },
        'meta-data': [{
          $: {
            'android:name': 'android.accessibilityservice',
            'android:resource': SERVICE_XML
          }
        }]
      });
    }
    return config;
  });
};
