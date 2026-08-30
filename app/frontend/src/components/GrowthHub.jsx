import { useTranslation } from "react-i18next";
import ChallengeBanner from "@/components/ChallengeBanner";
import SmartNotifCard from "@/components/SmartNotifCard";
import CloseFriendsPanel from "@/components/CloseFriendsPanel";
import ReferralCard from "@/components/ReferralCard";

/** Bloc Settings / croissance — parrainage + défis + amis proches. */
export default function GrowthHub({ user }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4 px-4 pb-8">
      <h2 className="text-base font-bold text-white">
        {t("growth.hub_title")}
      </h2>
      <ReferralCard user={user} />
      <ChallengeBanner />
      <CloseFriendsPanel />
      <SmartNotifCard user={user} />
    </div>
  );
}
