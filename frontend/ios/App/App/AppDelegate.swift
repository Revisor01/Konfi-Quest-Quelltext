import UIKit
import Capacitor
import FirebaseCore
import FirebaseMessaging
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    // HIER: Statische Variable, um den Token zu speichern
    static var fcmToken: String?
    static var tokenSentToServer: Bool = false
    static var lastTokenSentTime: TimeInterval = 0

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // ENVIRONMENT DEBUG
        #if DEBUG
        print("[DEBUG] Running in DEBUG mode (Development/Xcode)")
        #else
        print("[RELEASE] Running in RELEASE mode (TestFlight/Production)")
        #endif

        // APNS Environment Detection
        if let path = Bundle.main.path(forResource: "embedded", ofType: "mobileprovision"),
           let data = NSData(contentsOfFile: path),
           let string = String(data: data as Data, encoding: .ascii) {
            if string.contains("aps-environment") {
                if string.contains("<string>development</string>") {
                    print("[PUSH] APNS Environment: DEVELOPMENT (Sandbox)")
                } else if string.contains("<string>production</string>") {
                    print("[PUSH] APNS Environment: PRODUCTION")
                }
            }
        }

        // Firebase konfigurieren
        FirebaseApp.configure()

        // Explizit Auto-Init aktivieren (manuelles Token-Management)
        Messaging.messaging().isAutoInitEnabled = true

        // Firebase Messaging Delegate setzen
        Messaging.messaging().delegate = self

        // Push Notification Delegate setzen (Permission wird nach Login angefordert)
        UNUserNotificationCenter.current().delegate = self

        // TESTFLIGHT FIX: Check if permissions are already granted
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            print("[PUSH] App Launch - Notification Status: \(settings.authorizationStatus.rawValue)")
            if settings.authorizationStatus == .authorized {
                print("[PUSH] Permissions already granted - registering for APNS immediately")
                DispatchQueue.main.async {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }
        }

        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let tokenString = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        print("[OK] APNS Device Token registered: \(tokenString.prefix(20))...")

        // GUIDE RECOMMENDATION: Set APNS token first, then get FCM token
        Messaging.messaging().apnsToken = deviceToken

        // Get FCM token directly using Firebase recommended approach
        Messaging.messaging().token { (token, error) in
            if let error = error {
                print("[ERROR] Error fetching FCM token after APNS: \(error)")
                NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
            } else if let token = token {
                print("[OK] FCM Token received after APNS registration: \(token.prefix(20))...")
                AppDelegate.fcmToken = token
                self.sendTokenToWebView(token: token)
                NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: token)
            }
        }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("[ERROR] Failed to register for remote notifications: \(error.localizedDescription)")
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    // ... (applicationWillResignActive etc. bleiben unverändert) ...

    func applicationWillResignActive(_ application: UIApplication) {}
    func applicationDidEnterBackground(_ application: UIApplication) {}
    func applicationWillEnterForeground(_ application: UIApplication) {}
    func applicationDidBecomeActive(_ application: UIApplication) {
        // TESTFLIGHT FIX: Token IMMER abrufen, da TestFlight andere Environment hat
        print("[PUSH] App became active - retrieving FCM token for environment")
        retrieveAndSendFCMToken()
    }
    func applicationWillTerminate(_ application: UIApplication) {}

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // MARK: - Push Permission Request (called after login)
    func requestPushPermissionsAfterLogin() {
        print("[PUSH] Requesting push permissions after login...")
        UNUserNotificationCenter.current().delegate = self

        // Check current authorization status first
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            print("[PUSH] Current notification settings: \(settings.authorizationStatus.rawValue)")
            print("[PUSH] Alert setting: \(settings.alertSetting.rawValue)")
            print("[PUSH] Badge setting: \(settings.badgeSetting.rawValue)")
            print("[PUSH] Sound setting: \(settings.soundSetting.rawValue)")
        }

        let authOptions: UNAuthorizationOptions = [.alert, .badge, .sound]
        UNUserNotificationCenter.current().requestAuthorization(options: authOptions) { granted, error in
            print("[OK] Push permission request after login - granted: \(granted)")
            if let error = error {
                print("[ERROR] Push permission error: \(error.localizedDescription)")
            }

            if granted {
                DispatchQueue.main.async {
                    print("[PUSH] Registering for remote notifications...")
                    UIApplication.shared.registerForRemoteNotifications()
                    // Token wird automatisch über MessagingDelegate empfangen
                }
            } else {
                print("[ERROR] Push permissions denied after login")
            }
        }
    }

    // MARK: - Public method for manual token retrieval (called from frontend)
    func forceTokenRetrieval() {
        print("[DEBUG] Manual token retrieval requested from frontend")
        retrieveAndSendFCMToken()
    }

    // MARK: - FCM Token Retrieval
    private func retrieveAndSendFCMToken() {
        print("[RETRY] Attempting to retrieve FCM token...")

        // Check if Firebase is configured
        guard FirebaseApp.app() != nil else {
            print("[ERROR] Firebase not configured!")
            return
        }

        // Check notification settings first
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            print("[PUSH] Notification authorization status: \(settings.authorizationStatus.rawValue)")
            // 0: notDetermined, 1: denied, 2: authorized, 3: provisional, 4: ephemeral
        }

        // Token aus Firebase abrufen
        Messaging.messaging().token { [weak self] token, error in
            if let error = error {
                print("[ERROR] Error fetching FCM token: \(error)")
                print("[ERROR] Error details: \(error.localizedDescription)")
                return
            }

            guard let token = token else {
                print("[ERROR] FCM token is nil - this usually means:")
                print("   - Push notifications not authorized")
                print("   - No internet connection")
                print("   - Firebase misconfigured")
                return
            }

            print("[OK] Retrieved FCM token: \(token.prefix(20))...")
            print("[PUSH] Full token length: \(token.count) characters")

            // Token in statischer Variable speichern
            AppDelegate.fcmToken = token

            // Token an WebView senden
            self?.sendTokenToWebView(token: token)
        }
    }

    private func sendTokenToWebView(token: String) {
        // ANTI-SPAM: Prüfe ob Token in letzten 10 Sekunden bereits gesendet wurde
        let now = Date().timeIntervalSince1970
        if AppDelegate.fcmToken == token && (now - AppDelegate.lastTokenSentTime) < 10.0 {
            print("[SKIP] Token bereits vor weniger als 10s gesendet, überspringe: \(token.prefix(20))...")
            return
        }

        print("[PUSH] Sending FCM token to WebView: \(token.prefix(20))...")
        AppDelegate.lastTokenSentTime = now

        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { // Längere Verzögerung für WebView readiness
            if let window = UIApplication.shared.windows.first,
               let rootController = window.rootViewController {

                var bridgeController: CAPBridgeViewController?

                if let bridge = rootController as? CAPBridgeViewController {
                    bridgeController = bridge
                } else if let navController = rootController as? UINavigationController,
                          let bridge = navController.viewControllers.first as? CAPBridgeViewController {
                    bridgeController = bridge
                } else if let bridge = rootController.children.first as? CAPBridgeViewController {
                    bridgeController = bridge
                }

                if let bridge = bridgeController, let webView = bridge.bridge?.webView {
                    let jsCode = """
                        if (window.dispatchEvent) {
                            window.dispatchEvent(new CustomEvent('fcmToken', {
                                detail: '\(token)'
                            }));
                            console.log('[OK] FCM Token Event dispatched');
                        } else {
                            console.log('[ERROR] dispatchEvent not available');
                        }
                    """

                    webView.evaluateJavaScript(jsCode) { (result, error) in
                        if error == nil {
                            print("[OK] FCM Token an WebView übertragen")
                            // TESTFLIGHT FIX: tokenSentToServer entfernt, da Tokens environment-spezifisch sind
                        } else {
                            print("[ERROR] Fehler beim Übertragen des FCM Tokens: \(error?.localizedDescription ?? "Unknown")")
                        }
                    }
                } else {
                    print("[WARN] WebView noch nicht bereit, wiederhole in 1 Sekunde...")
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                        self.sendTokenToWebView(token: token)
                    }
                }
            }
        }
    }

}

// MARK: - MessagingDelegate
extension AppDelegate: MessagingDelegate {
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let token = fcmToken else {
            print("[ERROR] Firebase FCM token is nil")
            return
        }

        print("[OK] Firebase FCM token received: \(token)")

        // WICHTIG: Den korrekten Token hier in der statischen Variable speichern
        AppDelegate.fcmToken = token

        // TESTFLIGHT FIX: Token immer senden, da environment-spezifisch
        sendTokenToWebView(token: token)
    }
}

// MARK: - UNUserNotificationCenterDelegate
extension AppDelegate: UNUserNotificationCenterDelegate {
    // Show notification banner when app is in foreground
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .badge, .sound])
    }

    // Handle notification tap (delegate to Capacitor)
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        completionHandler()
    }
}
