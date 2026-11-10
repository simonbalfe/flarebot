fn main() {
    println!("cargo:rerun-if-env-changed=FLAREBOT_APP_URL");
    tauri_build::build()
}
