import { Menu as BaseMenu } from "@base-ui/react/menu";
import styles from "./Menu.module.css";

/** A hairline between groups of menu items. */
export function MenuSeparator() {
  return <BaseMenu.Separator className={styles.separator} />;
}
