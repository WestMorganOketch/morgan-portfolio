import Admin from "@/components/Admin";

export const metadata = {
  title: "Job Radar",
  robots: { index: false, follow: false },
};

export default function AdminCareerPage() {
  return <Admin view="career" />;
}
