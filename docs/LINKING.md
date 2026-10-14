# Linking your devices

Link your phone, PC and other devices so they share one world. Work on the PC, pick up the phone, and
carry on where you left off.

## What you need

- A computer that stays on, on the same Wi-Fi or network as your other devices. It is the **home**:
  it keeps the shared save and decides which devices may join.
- Forge on each device: the Android app, a desktop app, or the web app run locally.

## Start the home

On that computer, in a terminal:

```sh
forge link --name "My PC"
```

(From a checkout: `node --experimental-strip-types scripts/link-node.ts --name "My PC"`.)

It prints one or more addresses, such as `192.168.1.20:7430`. Leave it running.

## Link a device

1. In Forge, open **Devices** in the side panel.
2. Enter the address the home printed, and a name for this device.
3. Tap **Link this device**. A six-digit code appears.
4. The home's terminal shows the device's name and a code. If the codes match, type `y`.

A different code means something between the two is not your home: refuse it.

The first device to link gives the home its world. Every device linked after that **takes the home's
world in place of its own**.

## Using it

- The device you are using is in charge, and the others follow it. Tap or press a key on another device
  and it takes over, starting from the latest save.
- What is shared: the world, its clock, the log, and whether the simulation is running. Not shared:
  which AI model a device runs, what it has selected, and islands visited through a portal.
- If the home is off or out of reach, each device keeps working on its own and catches up when the home
  is back. If two devices save at the same moment, the first save is kept and the other device is told.

## Removing a device

In **Devices**, tap **Remove** next to any other device, or **Unlink this device** on the device itself.
A removed device is refused from then on; to bring it back, link it again.

## Keep the home file safe

The home lives in `.forge/link-home.json` where you ran `forge link`. It holds the owner key: whoever
has it can add devices, so keep it private. Back it up: without it, every device has to link again.

## Limits for now

- The home runs as `forge link` on a computer with Node 22. Running it inside the apps is planned.
- Traffic stays on your network and every request is signed and checked, but it is not encrypted.
- The hosted web version can't reach a home (browsers block plain `http://` from an `https://` page). Use
  the Android or desktop app.
- Each device's clock must be within two minutes of the home's. Automatic time on both is enough.
