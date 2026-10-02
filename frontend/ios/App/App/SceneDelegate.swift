import UIKit
import Capacitor

/// Fenster-Aufbau und Lebenszyklus unter dem UIScene-Modell.
///
/// WARUM ES DIESE DATEI GIBT: Ab dem iOS-27-SDK (Xcode 27) ist der
/// Scene-Lebenszyklus Pflicht. Eine App ohne `UIApplicationSceneManifest`
/// startet gar nicht mehr, sondern bricht sofort ab:
///
///     "Application failed to launch: UIScene life cycle is required for
///      apps built with this SDK."
///
/// AUFBAU nach der offiziellen Anleitung (capacitorjs.com/docs/updating/8-5);
/// dieselbe Vorlage steckt in @capacitor/cli als ios-pods-template.
///
/// Der mitgelieferte `SceneDelegateProxy` reicht NICHT allein: Er ist ein
/// `UISceneDelegate` (reine Weiterleitung) und legt kein Fenster an. Ohne
/// diese Klasse startet die App mit schwarzem Bildschirm. Die Weiterleitungen
/// an den Proxy sind trotzdem noetig — an ihnen haengen die
/// `appUrlOpen`-Ereignisse von @capacitor/app.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = CAPBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }

    /// Der FCM-Token-Abruf, der vorher in `applicationDidBecomeActive` stand.
    ///
    /// WARUM ER HIERHER MUSSTE: Unter Scenes ruft iOS die
    /// `application…`-Lebenszyklusmethoden nicht mehr auf. Der Abruf waere
    /// beim Umbau STILL ausgefallen — kein Absturz, keine Meldung, nur kein
    /// Token mehr. Der Kommentar an der alten Stelle nannte ihn ausdruecklich
    /// "TESTFLIGHT FIX": TestFlight-Builds laufen in einer anderen
    /// APNs-Umgebung, deshalb wird der Token bei jedem Aktivwerden neu geholt
    /// statt nur einmal beim Start.
    ///
    /// `sceneDidBecomeActive` ist die Entsprechung zu
    /// `applicationDidBecomeActive` — dieselbe Stelle im Ablauf, nur eine
    /// Ebene tiefer.
    /// Ueber `forceTokenRetrieval()` statt direkt: `retrieveAndSendFCMToken()`
    /// ist `private`. Die oeffentliche Huelle gibt es bereits (sie wird auch
    /// vom Frontend gerufen) und tut genau dasselbe — das ist der kleinere
    /// Eingriff, als die Sichtbarkeit zu oeffnen.
    func sceneDidBecomeActive(_ scene: UIScene) {
        print("[PUSH] Scene became active - retrieving FCM token for environment")
        (UIApplication.shared.delegate as? AppDelegate)?.forceTokenRetrieval()
    }
}
