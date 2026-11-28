import { useLocale } from "../../i18n/LocaleContext";
import { type SimulatorRecoveryLabel } from "../../lib/simulatorSessions";

export function simulatorLabelText(label:SimulatorRecoveryLabel,t:ReturnType<typeof useLocale>["t"]) {
 const [color, number] = label.split("-");
 return t("simulator.labelFormat", { color:t(("simulator.labelColor."+color) as "simulator.labelColor.blue"), number });
}
