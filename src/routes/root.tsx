import { Outlet, Link } from "react-router";
import { useModelStatus } from "@/hooks/useModelStatus";
import { ModelIndicator } from "@/components/ui/ModelIndicator";
import { QueueIndicator } from "@/components/ui/QueueIndicator";

export function RootLayout() {
  const { modelStatus } = useModelStatus();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/libraries" className="text-xl font-bold text-gray-900">
            TextAI
          </Link>
          <div className="flex items-center gap-4">
            <QueueIndicator />
            <ModelIndicator status={modelStatus} />
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
