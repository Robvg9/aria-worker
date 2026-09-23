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
        versionCode = 24
        versionName = "1.1.18"
        val ariaBuildId = System.getenv("GITHUB_SHA") ?: "local"
        buildConfigField("String", "ARIA_BUILD_ID", "\"$ariaBuildId\"")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildFeatures {
        buildConfig = true
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
