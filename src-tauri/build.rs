fn main() {
    tauri_build::build();

    #[cfg(target_os = "macos")]
    {
        cc::Build::new()
            .file("src/native_tray.m")
            .flag("-fobjc-arc")
            .compile("native_tray");
        println!("cargo:rustc-link-lib=framework=AppKit");
    }
}
