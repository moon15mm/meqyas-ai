import { redirect } from "next/navigation";

/** There is no self-registration: accounts are created by the platform's administrators
 * (SUBSCRIPTIONS.md §4). Old links to this page land on sign-in. */
export default function RegisterPage(): never {
  redirect("/login");
}
