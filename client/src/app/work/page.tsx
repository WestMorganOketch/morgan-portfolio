import type { Metadata } from "next";
import GithubLiveDashboard from "@/components/GithubLiveDashboard";

export const metadata: Metadata = {
  title: "Work in Real Time",
  description: "Live public GitHub profile statistics, primary-language distribution, recent public activity, and recently updated repositories for Morgan West Oketch.",
  openGraph: {
    title: "The work, in real time. | Morgan West Oketch",
    description: "Explore live public GitHub statistics, recent activity, languages, and repositories.",
  },
};

export default function WorkInRealTimePage() {
  return (
    <div className="inner-page inner-page-work">
      <div className="github-live-content">
        <GithubLiveDashboard />
      </div>
    </div>
  );
}
