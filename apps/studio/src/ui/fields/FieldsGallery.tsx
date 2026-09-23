import { useState } from "react";
import { GallerySection, Specimen } from "../gallery/GallerySection";
import { Checkbox } from "./Checkbox";
import styles from "./FieldsGallery.module.css";
import { NumberField } from "./NumberField";
import { RadioGroup, type RadioOption } from "./RadioGroup";
import { SegmentedToggle } from "./SegmentedToggle";
import { Select, type SelectOption } from "./Select";
import { Switch } from "./Switch";
import { TextField } from "./TextField";
import { ToggleButton } from "./ToggleButton";

const WALLET = "Connect a wallet first";
const BLOCKERS = "Resolve 2 blockers · F8";
const ACK = "I understand this deploys unaudited code";
const ACCOUNT = "0xC584D72D380Cb5b1e3aB71383a168C93d08e0Fe2";
const SALT = "0x4d631cbb92253e2f0d4268cf5019d60a50e0b54791ba533a9f897bd0f6715456";

const THEMES = [
  { value: "shop", label: "Shop" },
  { value: "draft", label: "Draft" },
] as const;

const NETWORKS: SelectOption[] = [
  { value: "anvil", label: "Anvil", description: "Local node" },
  { value: "sepolia", label: "Sepolia" },
  { value: "base-sepolia", label: "Base Sepolia" },
];

const DEPLOY_WITH: RadioOption[] = [
  { value: "wallet", label: "Connected wallet", description: "Signs each transaction in your wallet." },
  { value: "safe", label: "Safe batch", description: "Proposes one batch to your Safe." },
  { value: "foundry", label: "Foundry script" },
];

const DEPLOY_WITH_NO_WALLET: RadioOption[] = [
  { value: "wallet", label: "Connected wallet", disabledReason: WALLET },
  { value: "safe", label: "Safe batch" },
  { value: "foundry", label: "Foundry script" },
];

const TIME_UNITS = [
  { value: "s", label: "s" },
  { value: "min", label: "min" },
];

const AMOUNT_UNITS = [
  { value: "ether", label: "ether" },
  { value: "gwei", label: "gwei" },
  { value: "wei", label: "wei" },
];

const noop = () => {};

/** Toggles, switches, checkboxes, radios, selects and text and number fields, in every state. */
export function FieldsGallery() {
  const [minimap, setMinimap] = useState(true);
  const [theme, setTheme] = useState<"shop" | "draft">("shop");
  const [motion, setMotion] = useState(true);
  const [ack, setAck] = useState(true);
  const [deployWith, setDeployWith] = useState("safe");
  const [network, setNetwork] = useState<string | null>(null);
  const [chosenNetwork, setChosenNetwork] = useState("sepolia");
  const [salt, setSalt] = useState(SALT);
  const [timeout, setTimeoutValue] = useState("5");
  const [timeoutUnit, setTimeoutUnit] = useState("min");
  const [supply, setSupply] = useState("1000000");
  const [supplyUnit, setSupplyUnit] = useState("ether");

  return (
    <>
      <GallerySection title="Toggle buttons">
        <Specimen label="Default">
          <ToggleButton>Minimap</ToggleButton>
          <ToggleButton icon="keyboard" label="Show shortcuts" />
        </Specimen>
        <Specimen label="Pressed">
          <ToggleButton icon="minimap" pressed={minimap} onPressedChange={setMinimap}>
            Minimap
          </ToggleButton>
          <ToggleButton icon="keyboard" label="Show shortcuts" defaultPressed size="small" />
        </Specimen>
        <Specimen label="Disabled with a reason">
          <ToggleButton disabledReason={WALLET}>Watch balances</ToggleButton>
          <ToggleButton icon="wallet" label="Watch balances" disabledReason={WALLET} defaultPressed />
        </Specimen>
      </GallerySection>

      <GallerySection title="Segmented toggle">
        <Specimen label="Default">
          <SegmentedToggle label="Theme" options={THEMES} value={theme} onValueChange={setTheme} />
        </Specimen>
        <Specimen label="Disabled with a reason">
          <SegmentedToggle label="Theme" options={THEMES} value="draft" onValueChange={noop} disabledReason={BLOCKERS} />
        </Specimen>
      </GallerySection>

      <GallerySection title="Switches">
        <Specimen label="Default">
          <Switch label="Show the dot grid" />
        </Specimen>
        <Specimen label="Checked, with a description">
          <Switch
            label="Reduce motion"
            description="Viewport moves jump instead of gliding."
            checked={motion}
            onCheckedChange={setMotion}
            className={styles.cell}
          />
        </Specimen>
        <Specimen label="Disabled with a reason">
          <Switch label="Use the connected wallet" disabledReason={WALLET} />
          <Switch label="Announce deploy output" defaultChecked disabledReason={BLOCKERS} />
        </Specimen>
      </GallerySection>

      <GallerySection title="Checkboxes">
        <Specimen label="Default">
          <Checkbox label={ACK} />
        </Specimen>
        <Specimen label="Checked, with a description">
          <Checkbox
            label={ACK}
            description="No audit covers ERC20Pausable at this Lattice tag."
            checked={ack}
            onCheckedChange={setAck}
            className={styles.cell}
          />
        </Specimen>
        <Specimen label="Disabled with a reason">
          <Checkbox label={ACK} disabledReason={BLOCKERS} className={styles.cell} />
          <Checkbox label="Save the salt with the project" defaultChecked disabledReason={WALLET} />
        </Specimen>
      </GallerySection>

      <GallerySection title="Radio groups">
        <Specimen label="Default, with descriptions">
          <RadioGroup label="Deploy with" options={DEPLOY_WITH} value={deployWith} onValueChange={setDeployWith} />
        </Specimen>
        <Specimen label="An option disabled with a reason">
          <RadioGroup label="Deploy with" options={DEPLOY_WITH_NO_WALLET} defaultValue="foundry" />
        </Specimen>
      </GallerySection>

      <GallerySection title="Selects">
        <Specimen label="Default">
          <Select
            label="Network"
            placeholder="Choose a network"
            options={NETWORKS}
            value={network}
            onValueChange={setNetwork}
            className={styles.cell}
          />
        </Specimen>
        <Specimen label="Filled, with a description">
          <Select
            label="Network"
            options={NETWORKS}
            value={chosenNetwork}
            onValueChange={setChosenNetwork}
            description="Where the diamond deploys."
            className={styles.cell}
          />
        </Specimen>
        <Specimen label="Disabled with a reason">
          <Select label="Network" options={NETWORKS} defaultValue="anvil" disabledReason={WALLET} className={styles.cell} />
        </Specimen>
      </GallerySection>

      <GallerySection title="Text fields">
        <Specimen label="Default">
          <TextField label="Project name" placeholder="GovernedVault" className={styles.cell} />
        </Specimen>
        <Specimen label="Filled, with a description">
          <TextField
            label="Salt"
            value={salt}
            onValueChange={setSalt}
            description="32 bytes. The same salt and code give the same address on every chain."
            mono
            className={styles.wide}
          />
        </Specimen>
        <Specimen label="Invalid">
          <TextField
            label="Salt"
            defaultValue="0x12"
            error="Salt is 1 byte. Enter 32 bytes: 64 hex digits after 0x."
            mono
            required
            className={styles.cell}
          />
        </Specimen>
        <Specimen label="Read-only">
          <TextField label="Deploying account" value={ACCOUNT} readOnly mono className={styles.wide} />
        </Specimen>
        <Specimen label="Disabled with a reason">
          <TextField label="Deploying account" defaultValue="" disabledReason={WALLET} mono className={styles.cell} />
        </Specimen>
      </GallerySection>

      <GallerySection title="Number fields">
        <Specimen label="Default, with units">
          <NumberField
            label="Receipt timeout"
            value={timeout}
            onValueChange={setTimeoutValue}
            units={TIME_UNITS}
            unit={timeoutUnit}
            onUnitChange={setTimeoutUnit}
            min="1"
            className={styles.cell}
          />
        </Specimen>
        <Specimen label="Filled, with a description">
          <NumberField
            label="Initial supply"
            value={supply}
            onValueChange={setSupply}
            units={AMOUNT_UNITS}
            unit={supplyUnit}
            onUnitChange={setSupplyUnit}
            description="Minted to the deploying account. ↑ and ↓ step by 1; Shift steps by 10."
            className={styles.cell}
          />
        </Specimen>
        <Specimen label="Invalid">
          <NumberField
            label="Receipt timeout"
            value="0"
            onValueChange={noop}
            units={TIME_UNITS}
            unit="s"
            error="Receipt timeout is 0 s. Enter 1 s or more."
            className={styles.cell}
          />
        </Specimen>
        <Specimen label="Read-only">
          <NumberField label="Chain ID" value="11155111" onValueChange={noop} readOnly className={styles.cell} />
        </Specimen>
        <Specimen label="Disabled with a reason">
          <NumberField
            label="Initial supply"
            value="1000000"
            onValueChange={noop}
            units={AMOUNT_UNITS}
            unit="ether"
            disabledReason={BLOCKERS}
            className={styles.cell}
          />
        </Specimen>
      </GallerySection>
    </>
  );
}
