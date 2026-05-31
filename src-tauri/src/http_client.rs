use std::sync::LazyLock;
use std::time::Duration;

/// Shared HTTP client reused across all providers so TCP/TLS connections are
/// pooled and kept alive instead of re-handshaking on every poll tick.
/// reqwest::Client is internally an Arc — cloning it is cheap and shares the pool.
pub static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
});
