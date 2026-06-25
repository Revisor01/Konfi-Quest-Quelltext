import Foundation
import Capacitor

@objc(FCMPlugin)
public class FCMPlugin: CAPPlugin {

    override public func load() {
        // Listener für FCM Token Events
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleFCMTokenReceived(_:)),
            name: NSNotification.Name("FCMTokenReceived"),
            object: nil
        )
    }

    @objc func handleFCMTokenReceived(_ notification: Notification) {
        if let userInfo = notification.userInfo,
           let token = userInfo["token"] as? String {
            print("[OK] Plugin: FCM Token Event empfangen, sende an WebView")

            // Event an WebView weiterleiten
            notifyListeners("fcmTokenReceived", data: ["token": token])
        }
    }

    @objc func forceAPNSRegistration(_ call: CAPPluginCall) {
        print("[DEBUG] FCM Plugin: Force APNS Registration requested")
        DispatchQueue.main.async {
            UIApplication.shared.registerForRemoteNotifications()
            call.resolve(["success": true])
        }
    }

    @objc func forceTokenRetrieval(_ call: CAPPluginCall) {
        print("[DEBUG] FCM Plugin: Force FCM Token Retrieval requested")
        if let appDelegate = UIApplication.shared.delegate as? AppDelegate {
            appDelegate.forceTokenRetrieval()
            call.resolve(["success": true])
        } else {
            call.reject("Could not access AppDelegate")
        }
    }

    @objc func getFCMToken(_ call: CAPPluginCall) {
        // Greife auf den gespeicherten Token aus dem AppDelegate zu
        if let token = AppDelegate.fcmToken {
            print("[OK] Plugin: FCM Token found, returning to JS.")
            call.resolve([
                "token": token
            ])
        } else {
            // Falls der Token noch nicht da ist, warte eine Sekunde und versuche es erneut.
            // Das kann passieren, wenn die JS-Seite schneller ist als Firebase.
            print("[WARN] Plugin: FCM token not available yet, waiting 1s...")
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                if let token = AppDelegate.fcmToken {
                    print("[OK] Plugin: FCM Token found on second try.")
                    call.resolve(["token": token])
                } else {
                    print("[ERROR] Plugin: FCM token still not available.")
                    call.reject("FCM token could not be retrieved.")
                }
            }
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }
}
