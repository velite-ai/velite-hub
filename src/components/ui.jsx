import { useEffect, useState } from "react";

export function Modal({ title, onClose, children, actions, wide }) {
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className={`modal ${wide ? "modal-wide" : ""}`} onMouseDown={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}

// "Are you sure?" dialog. Usage: const [ask, dialog] = useConfirm(); ask({title, body, okText, danger}).then(ok => ...)
export function useConfirm() {
  const [state, setState] = useState(null);
  const ask = (opts) => new Promise((resolve) => setState({ ...opts, resolve }));
  const close = (v) => { state?.resolve(v); setState(null); };
  const dialog = state ? (
    <Modal title={state.title || "Are you sure?"} onClose={() => close(false)}
      actions={<>
        <button className="btn-ghost" onClick={() => close(false)}>Cancel</button>
        <button className={state.danger ? "btn-danger" : "btn-primary"} onClick={() => close(true)} autoFocus>
          {state.okText || "Yes"}
        </button>
      </>}>
      {state.body && <p className="modal-text">{state.body}</p>}
    </Modal>
  ) : null;
  return [ask, dialog];
}

export function Field({ label, children, hint }) {
  return (
    <div className="form-row">
      <label className="form-label">{label}</label>
      {children}
      {hint && <div className="form-hint">{hint}</div>}
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function Tag({ color, children, title }) {
  return <span className="tag" style={{ background: color }} title={title}>{children}</span>;
}

export function SearchBox({ value, onChange, placeholder = "Search…" }) {
  return (
    <input className="inp search-inp" type="search" placeholder={placeholder}
      value={value} onChange={(e) => onChange(e.target.value)} />
  );
}

export function Collapse({ label, badge, children, defaultOpen = false, tone = "green" }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`collapse collapse-${tone}`}>
      <div className="collapse-head" onClick={() => setOpen((o) => !o)}>
        <span className="collapse-arrow">{open ? "▼" : "▶"}</span>
        <span className="collapse-label">{label}</span>
        {badge !== undefined && <span className="collapse-badge">{badge}</span>}
      </div>
      {open && <div className="collapse-body">{children}</div>}
    </div>
  );
}
