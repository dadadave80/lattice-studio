// S9's services (contracts §5.2): announcements and region props.
import { provideServices } from "@/contracts";
import { announceImpl } from "./announcer";
import { useRegionImpl } from "./use-region";

provideServices({ announce: announceImpl, useRegion: useRegionImpl });
