# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# ---------------------------------------------------------------------------
# Regeln fuer minifyEnabled true
#
# ANLASS: Die Play Console meldete "DEX-Codeoptimierung unter dem Grenzwert",
# Verschleierung 2 Prozent, Frist Februar 2027. Ursache war minifyEnabled
# false -- es wurde schlicht nichts optimiert.
#
# WARUM DIESE REGELN NOETIG SIND: Capacitor findet seine Plugins ueber
# Reflection. Der Bruecken-Code sucht Klassen und Methoden zur Laufzeit
# anhand ihrer NAMEN; benennt R8 sie um, findet er sie nicht mehr. Der
# Fehler zeigt sich nicht beim Bauen, sondern erst auf dem Geraet -- und
# dort als "Plugin tut nichts", nicht als Absturz mit Hinweis.

# Capacitor-Bruecke und alle Plugins. @CapacitorPlugin-Annotation und die
# ueber JS aufgerufenen Methoden muessen ihre Namen behalten.
-keep public class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * {
    @com.getcapacitor.PluginMethod public <methods>;
}
-keep public class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod <methods>;
}

-keep class com.capacitorjs.plugins.** { *; }
-keep class io.capawesome.** { *; }
-keep class ee.forgr.** { *; }
-keep class com.capacitorcommunity.** { *; }

# Firebase Cloud Messaging -- ohne das kommen keine Push-Nachrichten mehr an.
# Genau dieser Ausfall hat im September 2026 schon einmal Wochen gekostet.
#
# Deckt AUCH die Absturzdiagnose (Crashlytics) ab: Deren Klassen liegen
# unter com.google.firebase.crashlytics.**, das Capacitor-Plugin unter
# io.capawesome.** (Regel weiter oben). Hier steht deshalb bewusst KEINE
# zusaetzliche Zeile — zwei Regeln fuer dieselben Klassen wuerden nur
# suggerieren, es waeren verschiedene.
#
# Was die Lesbarkeit der Berichte sichert, ist NICHT eine keep-Regel, sondern
# der Upload der Mapping-Datei (siehe firebaseCrashlytics-Block in
# app/build.gradle) zusammen mit -keepattributes SourceFile,LineNumberTable
# weiter unten.
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# Cordova-Plugins laufen ueber dieselbe Reflection-Bruecke.
-keep class org.apache.cordova.** { *; }

# WebView-Bruecke: Methoden mit @JavascriptInterface werden aus dem Web
# heraus per Namen gerufen.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Klassen, die aus JSON gelesen werden, brauchen ihre Feldnamen.
-keepclassmembers class * {
    @com.google.gson.annotations.SerializedName <fields>;
}

# AndroidX und Material -- Views werden aus XML ueber ihren Namen erzeugt.
-keep public class * extends android.view.View {
    public <init>(android.content.Context);
    public <init>(android.content.Context, android.util.AttributeSet);
    public <init>(android.content.Context, android.util.AttributeSet, int);
}

# Zeilennummern in Absturzberichten erhalten -- ohne das sind die Berichte
# aus der Play Console nicht lesbar.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Annotationen, die zur Laufzeit gelesen werden (Capacitor tut genau das).
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

# ShortcutBadger legt seine Badger ueber eine Liste von Klassen an
# (Class.newInstance in ShortcutBadger.initBadger). R8 sieht diesen Aufruf
# nicht. Die mitgelieferten Regeln des AAR schuetzen nur einen Teil der
# Konstruktoren -- Samsung, Huawei, OPPO, ZUK und ZTE fehlen dort.
-keep class me.leolin.shortcutbadger.** { *; }
