#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Definiere den Plugin für Capacitor
CAP_PLUGIN(FCMPlugin, "FCM",
           CAP_PLUGIN_METHOD(getFCMToken, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(forceAPNSRegistration, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(forceTokenRetrieval, CAPPluginReturnPromise);
)