import { Hexagon } from 'lucide-react';
import { DemoSignIn } from '@/components/demo-sign-in';
import { SignInForm } from '@/components/sign-in-form';
import { demoOffered } from '@/lib/recall';

// Shown only where the server offers it. The console asks the server rather than reading its own
// env, so the button can never appear on a deployment that would then refuse it.
export default async function SignIn() {
  const demo = await demoOffered();
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="mb-8 flex items-center gap-2">
        <Hexagon className="h-7 w-7 text-cyan-400" />
        <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-xl font-bold text-transparent">
          RECALL
        </span>
      </div>
      <div className="panel p-6">
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-slate-400">
          Your memory is yours. Enter the email you were invited with and we&rsquo;ll send a link that signs you in for
          30 days.
        </p>
        <SignInForm />
        {demo ? <DemoSignIn /> : null}
      </div>
      <p className="mt-4 text-xs text-slate-500">
        Running locally? The development mailer prints the link in the Recall server log.
      </p>
    </main>
  );
}
