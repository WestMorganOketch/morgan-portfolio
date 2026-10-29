import Admin from "@/components/Admin";

export const metadata = {
  title: "Admin sign in",
  robots: { index: false, follow: false },
};

export default function AdminLoginPage() {
  return <Admin loginOnly />;
}
