import { hideBanner } from "@/contracts";
import { Banner } from "@/ui";
import { useBanners } from "./banner-store";
import styles from "./BannerHost.module.css";

/**
 * Renders every banner up now (IR L199-L210), content supplied by its owner through `showBanner`. There is
 * no board for banner placement yet (PA L72-L84), so this reads as a stack across the top of whatever it's
 * mounted in, nearest to the empty-sheet and title-block boards that show one banner at a time.
 */
export function BannerHost() {
  const banners = useBanners();
  if (banners.length === 0) return null;
  return (
    <div className={styles.host}>
      {banners.map(({ id, props }) => (
        <Banner key={id} {...props} onDismiss={() => hideBanner(id)} />
      ))}
    </div>
  );
}
