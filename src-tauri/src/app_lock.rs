use crate::credentials;
use std::{sync::Mutex, time::{Duration, Instant}};

struct LockState {
    unlocked: bool,
    last_activity: Option<Instant>,
    idle_minutes: u64,
    failures: u32,
    retry_after: Option<Instant>,
}

static STATE: Mutex<LockState> = Mutex::new(LockState {
    unlocked: false,
    last_activity: None,
    idle_minutes: 5,
    failures: 0,
    retry_after: None,
});

fn state() -> Result<std::sync::MutexGuard<'static, LockState>, String> {
    STATE.lock().map_err(|_| "Bloqueio nativo indisponível.".to_string())
}

fn expire(s: &mut LockState) {
    if s.idle_minutes > 0 && s.last_activity.map(|time| time.elapsed() >= Duration::from_secs(s.idle_minutes * 60)).unwrap_or(true) {
        s.unlocked = false;
    }
}

pub fn is_locked() -> Result<bool, String> {
    let mut s = state()?;
    if !credentials::has_app_lock()? { return Ok(false); }
    expire(&mut s);
    Ok(!s.unlocked)
}

pub fn require_unlocked() -> Result<(), String> {
    if is_locked()? { return Err("Seven Mail bloqueado. Desbloqueie com o PIN.".into()); }
    Ok(())
}

fn check_pin(s: &mut LockState, pin: &str) -> Result<bool, String> {
    if s.retry_after.map(|until| Instant::now() < until).unwrap_or(false) {
        return Err("Muitas tentativas. Aguarde antes de tentar novamente.".into());
    }
    if pin.len() > 64 { return Ok(false); }
    if credentials::verify_app_lock(pin)? {
        s.failures = 0;
        s.retry_after = None;
        return Ok(true);
    }
    s.failures = s.failures.saturating_add(1);
    let seconds = retry_delay(s.failures);
    if seconds > 0 { s.retry_after = Some(Instant::now() + Duration::from_secs(seconds)); }
    Ok(false)
}

fn retry_delay(failures: u32) -> u64 {
    if failures < 5 { 0 } else { 5u64 * (1u64 << (failures - 5).min(6)) }
}

pub fn unlock(pin: &str) -> Result<bool, String> {
    let mut s = state()?;
    if !check_pin(&mut s, pin)? { return Ok(false); }
    s.unlocked = true;
    s.last_activity = Some(Instant::now());
    Ok(true)
}

pub fn lock() -> Result<(), String> {
    let mut s = state()?;
    s.unlocked = false;
    s.last_activity = None;
    Ok(())
}

pub fn activity(minutes: Option<u64>) -> Result<bool, String> {
    let mut s = state()?;
    if !credentials::has_app_lock()? { return Ok(true); }
    expire(&mut s);
    if !s.unlocked { return Ok(false); }
    if let Some(minutes) = minutes {
        if ![0, 1, 5, 15, 30].contains(&minutes) { return Err("Tempo de bloqueio inválido.".into()); }
        s.idle_minutes = minutes;
    }
    s.last_activity = Some(Instant::now());
    Ok(true)
}

pub fn configure(pin: &str, current_pin: Option<&str>) -> Result<(), String> {
    let mut s = state()?;
    if credentials::has_app_lock()? {
        expire(&mut s);
        if !s.unlocked || !check_pin(&mut s, current_pin.unwrap_or(""))? {
            return Err("Confirme o PIN atual para alterar o bloqueio.".into());
        }
    }
    credentials::set_app_lock(pin)?;
    s.unlocked = true;
    s.last_activity = Some(Instant::now());
    Ok(())
}

pub fn disable(pin: &str) -> Result<(), String> {
    let mut s = state()?;
    expire(&mut s);
    if credentials::has_app_lock()? && (!s.unlocked || !check_pin(&mut s, pin)?) {
        return Err("Confirme o PIN atual para desativar o bloqueio.".into());
    }
    credentials::clear_app_lock()?;
    s.unlocked = false;
    s.last_activity = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repeated_attempts_increase_wait_with_bounded_delay() {
        assert_eq!(retry_delay(4), 0);
        assert_eq!(retry_delay(5), 5);
        assert_eq!(retry_delay(6), 10);
        assert_eq!(retry_delay(u32::MAX), 320);
    }
    #[test]
    fn expiration_revokes_access() {
        let mut s = LockState { unlocked: true, last_activity: Some(Instant::now() - Duration::from_secs(61)), idle_minutes: 1, failures: 0, retry_after: None };
        expire(&mut s);
        assert!(!s.unlocked);
    }
}
