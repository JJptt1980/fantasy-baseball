import javax.inject.Inject

plugins {
    id("com.android.application")
}

android {
    namespace = "com.jjptt.fantasybaseball"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.jjptt.fantasybaseball"
        minSdk = 30
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
}

// 把網頁版（docs/advisor、docs/icons）打包進 APK 的 assets/web/
abstract class CopyWebAssets : DefaultTask() {
    @get:InputDirectory
    abstract val webDir: DirectoryProperty

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @get:Inject
    abstract val fs: FileSystemOperations

    @TaskAction
    fun run() {
        fs.sync {
            from(webDir) {
                include("advisor/**", "icons/**")
                into("web")
            }
            into(outputDir)
        }
    }
}

val copyWeb = tasks.register<CopyWebAssets>("copyWebAssets") {
    webDir.set(rootProject.layout.projectDirectory.dir("../docs"))
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(copyWeb, CopyWebAssets::outputDir)
    }
}
