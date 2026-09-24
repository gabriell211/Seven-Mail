import { useEffect, useState } from "react";

export function LaunchScreen({ ready }: { ready: boolean }) {
  const [visible, setVisible] = useState(true);
  const [finishing, setFinishing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [startedAt] = useState(() => Date.now());

  useEffect(() => {
    if (!ready || !visible) return;

    const minimumVisibleMs = 1050;
    const wait = Math.max(0, minimumVisibleMs - (Date.now() - startedAt));
    let finishTimer = 0;
    let closeTimer = 0;
    let removeTimer = 0;

    const startFinish = () => {
      setFinishing(true);
      closeTimer = window.setTimeout(() => setClosing(true), 360);
      removeTimer = window.setTimeout(() => setVisible(false), 880);
    };

    finishTimer = window.setTimeout(startFinish, wait);

    return () => {
      window.clearTimeout(finishTimer);
      window.clearTimeout(closeTimer);
      window.clearTimeout(removeTimer);
    };
  }, [ready, startedAt, visible]);

  if (!visible) return null;

  return (
    <div
      className={[
        "launch-screen",
        finishing ? "is-finishing" : "",
        closing ? "is-closing" : "",
      ].filter(Boolean).join(" ")}
      role="status"
      aria-live="polite"
      aria-label="Seven Mail está iniciando"
    >
      <div className="launch-screen__aurora launch-screen__aurora--one" />
      <div className="launch-screen__aurora launch-screen__aurora--two" />

      <div className="launch-screen__content">
        <div className="launch-seven" aria-hidden="true">
          <svg viewBox="0 0 180 220" className="launch-seven__svg">
            <defs>
              <linearGradient id="launch-seven-fill" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0%" stopColor="#7058ff" />
                <stop offset="44%" stopColor="#276ff7" />
                <stop offset="100%" stopColor="#21d9ee" />
              </linearGradient>

              <linearGradient id="launch-seven-stroke" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0%" stopColor="#755fff" stopOpacity=".42" />
                <stop offset="52%" stopColor="#3a8cff" stopOpacity=".56" />
                <stop offset="100%" stopColor="#41e8ee" stopOpacity=".72" />
              </linearGradient>

              <clipPath id="launch-seven-clip">
                <path d="M24 22c0-8 6-14 14-14h112c8 0 14 6 14 14v12c0 7-3 12-8 17l-28 28c-19 20-34 41-45 65-9 20-17 41-23 64-2 7-8 12-15 12H27c-10 0-17-10-14-20 8-28 18-53 30-76 13-25 30-49 52-72H38c-8 0-14-6-14-14V22Z" />
              </clipPath>

              <filter id="launch-seven-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="6" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <path
              className="launch-seven__outline"
              d="M24 22c0-8 6-14 14-14h112c8 0 14 6 14 14v12c0 7-3 12-8 17l-28 28c-19 20-34 41-45 65-9 20-17 41-23 64-2 7-8 12-15 12H27c-10 0-17-10-14-20 8-28 18-53 30-76 13-25 30-49 52-72H38c-8 0-14-6-14-14V22Z"
            />

            <g clipPath="url(#launch-seven-clip)">
              <g className="launch-seven__liquid">
                <rect x="-12" y="-8" width="204" height="242" fill="url(#launch-seven-fill)" />
                <path
                  className="launch-seven__wave"
                  d="M-12 0 C18 -10 42 12 72 2 S126 -8 192 1 V24 H-12Z"
                  fill="#78f4f1"
                  opacity=".42"
                />
                <rect
                  className="launch-seven__shine"
                  x="25"
                  y="-30"
                  width="26"
                  height="290"
                  rx="13"
                  fill="white"
                  opacity=".18"
                  transform="rotate(18 90 110)"
                />
              </g>
            </g>

            <path
              className="launch-seven__edge"
              d="M24 22c0-8 6-14 14-14h112c8 0 14 6 14 14v12c0 7-3 12-8 17l-28 28c-19 20-34 41-45 65-9 20-17 41-23 64"
            />
          </svg>
        </div>

        <div className="launch-screen__copy">
          <strong>Seven Mail</strong>
          <span>{finishing ? "Tudo pronto" : "Preparando seu espaço"}</span>
        </div>
      </div>
    </div>
  );
}
