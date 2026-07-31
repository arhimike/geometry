import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  ArrowsOut,
  Broom,
  Circle,
  Copy,
  Cube,
  Cursor,
  Cylinder,
  HandGrabbing,
  Link,
  Lock,
  LockOpen,
  Minus,
  Moon,
  Pause,
  Play,
  Plus,
  Rectangle,
  Stack,
  Sun,
  Trash,
  Triangle,
  VirtualReality,
} from "@phosphor-icons/react";
import { SceneCanvas } from "./SceneCanvas.jsx";

const SHAPES = [
  { type: "cube", label: "Куб", Icon: Cube },
  { type: "sphere", label: "Сфера", Icon: Circle },
  { type: "cylinder", label: "Цилиндр", Icon: Cylinder },
  { type: "cone", label: "Конус", Icon: Triangle },
  { type: "pyramid", label: "Пирамида", Icon: Triangle },
  { type: "slab", label: "Плита", Icon: Rectangle },
  { type: "arch", label: "Арка", Icon: Stack },
];

const COLORS = ["#ff6b2c", "#2f74ff", "#ffd45d", "#f3f0e8", "#1fc8a5", "#a676ff"];
const LABELS = {
  cube: "Куб",
  sphere: "Сфера",
  cylinder: "Цилиндр",
  cone: "Конус",
  pyramid: "Пирамида",
  slab: "Плита",
  arch: "Арка",
};

function ToolButton({ children, label, active = false, className = "", style, onClick }) {
  return (
    <button
      className={`icon-button ${active ? "is-active" : ""} ${className}`}
      style={style}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
      <span className="tooltip">{label}</span>
    </button>
  );
}

function Range({ label, value, min, max, step, suffix = "", onChange }) {
  const progress = ((value - min) / (max - min)) * 100;
  return (
    <label className="range-field">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--progress": `${progress}%` }}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output>{value.toFixed(step < 0.1 ? 2 : 1)}{suffix}</output>
    </label>
  );
}

export function App() {
  const sceneRef = useRef(null);
  const [theme, setTheme] = useState(() => localStorage.getItem("gravity-theme") || "dark");
  const [selected, setSelected] = useState(null);
  const [gravity, setGravity] = useState(9.8);
  const [bounce, setBounce] = useState(0.18);
  const [friction, setFriction] = useState(0.58);
  const [playing, setPlaying] = useState(true);
  const [stats, setStats] = useState({ count: 0, fps: 60, xrSupported: null });
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("gravity-theme", theme);
  }, [theme]);

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  const showNotice = (message) => {
    setNotice(message);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 3200);
  };

  const mergeStats = (next) => setStats((current) => ({ ...current, ...next }));
  const arcOffsets = useMemo(() => [22, 10, 2, 0, 2, 10, 22], []);

  const updateMass = (value) => {
    sceneRef.current?.setMass(value);
    setSelected((current) => current ? { ...current, mass: value } : current);
  };

  return (
    <main className={`app-shell theme-${theme}`}>
      <SceneCanvas
        ref={sceneRef}
        theme={theme}
        gravity={gravity}
        bounce={bounce}
        friction={friction}
        playing={playing}
        onSelection={setSelected}
        onStats={mergeStats}
        onNotice={showNotice}
      />

      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark"><Cube weight="fill" /></span>
          <div>
            <strong>GRAVITY</strong>
            <span>SPATIAL WORKSHOP</span>
          </div>
        </div>
        <div className="project-signature">
          <span>DØMO LAB</span>
          <b>ARCHITOYS</b>
        </div>
        <div className="top-actions">
          <span className="scene-status"><i /> {stats.count} тел · {stats.fps} FPS</span>
          <button className="theme-switch" type="button" aria-label="Переключить тему" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            <Sun weight="bold" />
            <span className="switch-track"><i /></span>
            <Moon weight="fill" />
          </button>
          <button className="vr-button" type="button" onClick={() => sceneRef.current?.startVR()}>
            <VirtualReality weight="bold" />
            <span>ВОЙТИ В VR</span>
            {stats.xrSupported === true && <i className="ready-dot" />}
          </button>
        </div>
      </header>

      <aside className="shape-palette" aria-label="Библиотека форм">
        <div className="palette-lead">
          <Cursor weight="bold" />
          <span>ФОРМЫ</span>
        </div>
        {SHAPES.map(({ type, label, Icon }, index) => (
          <ToolButton
            key={type}
            label={`Добавить: ${label}`}
            className="shape-tool"
            style={{ "--arc-offset": `${arcOffsets[index]}px` }}
            onClick={() => sceneRef.current?.add(type)}
          >
            <Icon weight={type === "pyramid" ? "fill" : "regular"} />
          </ToolButton>
        ))}
        <span className="palette-divider" />
        <ToolButton label="Добавить стопку" onClick={() => sceneRef.current?.addStack()}>
          <Stack weight="bold" />
        </ToolButton>
        <ToolButton label="Очистить сцену" onClick={() => sceneRef.current?.clear()}>
          <Broom weight="bold" />
        </ToolButton>
      </aside>

      <aside className={`inspector ${selected ? "has-selection" : ""}`}>
        <div className="panel-heading">
          <span>ВЫБРАННЫЙ ОБЪЕКТ</span>
          <i className="selection-pip" />
        </div>
        {selected ? (
          <>
            <div className="object-card">
              <span className="object-icon"><Cube weight="duotone" /></span>
              <div>
                <strong>{LABELS[selected.type]}</strong>
                <span>{selected.id.toUpperCase()}</span>
              </div>
              <span className={`lock-state ${selected.locked ? "locked" : ""}`}>{selected.locked ? "FIX" : "LIVE"}</span>
            </div>

            <section className="property-group">
              <label>МАТЕРИАЛ</label>
              <div className="color-row">
                {COLORS.map((color) => (
                  <button
                    type="button"
                    key={color}
                    aria-label={`Цвет ${color}`}
                    className={selected.color === color ? "selected" : ""}
                    style={{ background: color }}
                    onClick={() => sceneRef.current?.setColor(color)}
                  />
                ))}
              </div>
            </section>

            <section className="property-group scale-group">
              <label>МАСШТАБ</label>
              <div className="stepper">
                <button type="button" aria-label="Уменьшить" onClick={() => sceneRef.current?.scale(-0.1)}><Minus /></button>
                <output>{selected.scale.toFixed(1)}×</output>
                <button type="button" aria-label="Увеличить" onClick={() => sceneRef.current?.scale(0.1)}><Plus /></button>
              </div>
            </section>

            <section className="property-group mass-group">
              <Range label="МАССА" value={selected.mass || 0} min={0.2} max={8} step={0.1} suffix=" кг" onChange={updateMass} />
            </section>

            <div className="object-actions">
              <button type="button" onClick={() => sceneRef.current?.toggleLock()}>
                {selected.locked ? <LockOpen /> : <Lock />}<span>{selected.locked ? "Освободить" : "Зафиксировать"}</span>
              </button>
              <button type="button" onClick={() => sceneRef.current?.duplicate()}><Copy /><span>Копировать</span></button>
              <button type="button" onClick={() => sceneRef.current?.armLink()}><Link /><span>Связать</span></button>
              <button className="danger" type="button" onClick={() => sceneRef.current?.remove()}><Trash /><span>Удалить</span></button>
            </div>
          </>
        ) : (
          <div className="empty-selection">
            <HandGrabbing weight="duotone" />
            <strong>Выберите тело</strong>
            <span>Нажмите на объект, чтобы изменить материал, массу или фиксацию.</span>
          </div>
        )}
      </aside>

      <section className="physics-dock" aria-label="Параметры физики">
        <div className="dock-title">
          <ArrowsOut weight="bold" />
          <span>ФИЗИКА СЦЕНЫ</span>
        </div>
        <Range label="ГРАВИТАЦИЯ" value={gravity} min={0} max={20} step={0.1} suffix="" onChange={setGravity} />
        <Range label="УПРУГОСТЬ" value={bounce} min={0} max={1} step={0.01} onChange={setBounce} />
        <Range label="ТРЕНИЕ" value={friction} min={0} max={1} step={0.01} onChange={setFriction} />
        <div className="transport">
          <ToolButton label={playing ? "Пауза" : "Продолжить"} active={!playing} onClick={() => setPlaying(!playing)}>
            {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
          </ToolButton>
          <ToolButton label="Один шаг" onClick={() => sceneRef.current?.step()}>
            <Play weight="bold" />
          </ToolButton>
          <ToolButton label="Сбросить сцену" onClick={() => sceneRef.current?.reset()}>
            <ArrowCounterClockwise weight="bold" />
          </ToolButton>
        </div>
      </section>

      <div className="interaction-hint">
        <span><Cursor /> выбрать</span>
        <span><HandGrabbing /> тянуть</span>
        <span>⇧ + колесо · масштаб</span>
      </div>

      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}
