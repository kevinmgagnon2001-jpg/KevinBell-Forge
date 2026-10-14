/**
 * Devices: link this device to your Forge home so your world follows you between devices.
 * The home is `forge link`, running on a PC on the same network (scripts/link-node.ts).
 */
import { useEffect, useState } from "react";
import { cancelPairing, guessDeviceName, pairDevice, refreshDevices, removeDevice, unlinkDevice, useLink } from "@/engine/link-browser";

function Code({ code }: { code: string }) {
  return (
    <p className="pair-code" aria-label={`Pairing code ${code.split("").join(" ")}`}>
      {code.slice(0, 3)}
      <span aria-hidden="true"> </span>
      {code.slice(3)}
    </p>
  );
}

function PairForm() {
  const detail = useLink((s) => s.detail);
  const busy = useLink((s) => s.phase === "pairing");
  const [address, setAddress] = useState("");
  const [name, setName] = useState(guessDeviceName);
  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        void pairDevice(address, name);
      }}
    >
      <p className="panel-lead">
        Share one world across your phone, PC and other devices. On a PC that stays on, run <code>forge link</code>; it prints an address to enter here.
      </p>
      <label className="arg">
        <span>Home address</span>
        <input className="field" value={address} placeholder="192.168.1.20:7430" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={(e) => setAddress(e.target.value)} />
      </label>
      <label className="arg">
        <span>This device's name</span>
        <input className="field" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      </label>
      {detail ? <p className="form-error">{detail}</p> : null}
      <p className="panel-lead">If the home already holds a world, it replaces the one on this device.</p>
      <button type="submit" className="btn btn-primary" disabled={busy || !address.trim()}>
        {busy ? "Reaching the home…" : "Link this device"}
      </button>
    </form>
  );
}

function Linked() {
  const { phase, detail, homeName, base, lead, lastFrom, devices, deviceId } = useLink();
  useEffect(() => {
    void refreshDevices();
    const timer = window.setInterval(() => void refreshDevices(), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="stack">
      <p className="panel-lead">
        {phase === "offline"
          ? `Can't reach ${homeName || "your home"} right now. This device keeps working and catches up when it's back.`
          : lead
            ? "In use here. Your other devices follow this one."
            : `Following ${lastFrom || "your other device"}. Tap or press a key here to continue on this device.`}
      </p>
      {detail ? <p className={phase === "offline" ? "mono-line" : "form-error"}>{detail}</p> : null}
      <p className="mono-line">
        {homeName} · {base.replace(/^https?:\/\//, "")}
      </p>
      {devices.length ? (
        <ul className="device-list">
          {devices.map((d) => (
            <li key={d.deviceId}>
              <span>
                <strong>{d.name}</strong>
                <em>{d.deviceId === deviceId ? "this device" : d.lead ? "in use" : d.online ? "online" : "offline"}</em>
              </span>
              {d.deviceId === deviceId ? null : (
                <button type="button" className="btn btn-ghost" onClick={() => void removeDevice(d.deviceId)}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <button type="button" className="btn btn-ghost" onClick={() => void unlinkDevice()}>
        Unlink this device
      </button>
    </div>
  );
}

export function DevicesCard() {
  const phase = useLink((s) => s.phase);
  const code = useLink((s) => s.code);
  const homeName = useLink((s) => s.homeName);
  const detail = useLink((s) => s.detail);
  const pill = phase === "linked" ? "Linked" : phase === "offline" ? "Offline" : phase === "waiting" ? "Pairing" : "Not linked";
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Devices</h2>
        <span className={phase === "linked" ? "live-pill is-on" : "live-pill"}>{pill}</span>
      </div>
      {phase === "waiting" ? (
        <div className="stack">
          <p className="panel-lead">{homeName} should show this code. If it matches, allow this device there.</p>
          <Code code={code} />
          <p className="panel-lead">A different code means something between the two is not your home: refuse it there.</p>
          <button type="button" className="btn btn-ghost" onClick={cancelPairing}>
            Cancel
          </button>
        </div>
      ) : phase === "linked" || phase === "offline" ? (
        <Linked />
      ) : (
        <>
          {phase === "removed" ? <p className="form-error">{detail}</p> : null}
          <PairForm />
        </>
      )}
    </section>
  );
}
