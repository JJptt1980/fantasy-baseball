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
        versionCode = 2
        versionName = "0.1.1"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.core:core:1.13.1")
}

// 把網頁版（docs/advisor、docs/icons）打包進 APK 的 assets/web/
abstract class CopyWebAssets : DefaultTask() {
    @get:InputDirectory
    abstract val webDir: DirectoryProperty

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    // 公開版（發到 beta repo 給 App 內更新用）不能帶聯盟私人資料、也不帶測試腳本
    @get:Input
    abstract val publicBuild: Property<Boolean>

    @get:Inject
    abstract val fs: FileSystemOperations

    @TaskAction
    fun run() {
        fs.sync {
            from(webDir) {
                include("advisor/**", "icons/**")
                if (publicBuild.get()) exclude("advisor/data/private/**", "advisor/_ux/**")
                into("web")
            }
            into(outputDir)
        }
    }
}

val copyWeb = tasks.register<CopyWebAssets>("copyWebAssets") {
    webDir.set(rootProject.layout.projectDirectory.dir("../docs"))
    // ./gradlew assembleDebug -PpublicBuild=true
    publicBuild.set(providers.gradleProperty("publicBuild").map { it == "true" }.orElse(false))
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(copyWeb, CopyWebAssets::outputDir)
    }
}
