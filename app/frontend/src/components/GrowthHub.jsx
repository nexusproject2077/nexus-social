import { useTranslation } from "react-i18next";
import ChallengeBanner from "@/components/ChallengeBanner";
import SmartNotifCard from "@/components/SmartNotifCard";
import CloseFriendsPanel from "@/components/CloseFriendsPanel";

/** Bloc Settings / croissance — parrainage à ajouter si installé */
export default function GrowthHub({ user }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4 px-4 pb-8">
      <h2 className="text-base font-bold text-white">{t("growth.hub_title")}</h2>
      <ChallengeBanner />
      <CloseFriendsPanel />
      <SmartNotifCard user={user} />
    </div>
  );
}
