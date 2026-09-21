plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.robvg9.ariauiagent"
    val runnerSdk = System.getenv("ANDROID_COMPILE_SDK")?.toIntOrNull() ?: 35
    compileSdk = runnerSdk

    defaultConfig {
        applicationId = "com.robvg9.ariauiagent"
        minSdk = 26
        targetSdk = runnerSdk
        versionCode = 17
        versionName = "1.1.11"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
        debug {
            applicationIdSuffix = ".debug"
        }
    }

    testOptions {
        unitTests.isIncludeAndroidResources = false
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}

// Emergency restore: if AriaAccessibilityService was accidentally replaced with PLACEHOLDER,
// pull the last known-good body so assembleDebug can succeed.
tasks.register("restoreServiceIfPlaceholder") {
    doLast {
        val f = file("src/main/java/com/robvg9/ariauiagent/AriaAccessibilityService.kt")
        if (!f.exists()) return@doLast
        val text = f.readText().trim()
        if (text == "PLACEHOLDER_SERVICE" || text == "PLACEHOLDER") {
            val url =
                "https://raw.githubusercontent.com/Robvg9/aria-worker/42b8e654a65e9724fde98dc76663853bd47179a0/android-ui-agent/app/src/main/java/com/robvg9/ariauiagent/AriaAccessibilityService.kt"
            f.writeText(java.net.URL(url).readText())
            println("Restored AriaAccessibilityService.kt from known-good commit 42b8e654")
        }
    }
}
tasks.matching { it.name == "preBuild" || it.name.startsWith("compile") }.configureEach {
    dependsOn("restoreServiceIfPlaceholder")
}
