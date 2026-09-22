"use client";

import { useState } from "react";
import { CrmProvider, useCrm } from "./store";
import InvestorDetail from "./InvestorDetail";
import Home from "./screens/Home";
import Investors from "./screens/Investors";
import Contacts from "./screens/Contacts";
import Activity from "./screens/Activity";
import Tasks from "./screens/Tasks";
import Pipeline from "./screens/Pipeline";
import type { LivePosition } from "@/lib/crm-types";

const TABS = [
  { id: "home", label: "Home" },
  { id: "investors", label: "Investors" },
  { id: "contacts", label: "Contacts" },
  { id: "activity", label: "Activity" },
  { id: "tasks", label: "Tasks" },
  { id: "pipeline", label: "Pipeline" },
];

function CrmInner({ live }: { live: Record<string, LivePosition> }) {
  const { reset } = useCrm();
  const [tab, setTab] = useState("home");
  const [openId, setOpenId] = useState<string | null>(null);
  const open = (id: string) => setOpenId(id);

  return (
    <div className="space-y-4">
      {/* preview banner */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <span className="font-semibold">Preview — sample data.</span>
        <span>Everything here is saved only in this browser (nothing sent anywhere). Team login &amp; shared database come next.</span>
        <button onClick={() => confirm("Reset the CRM preview back to the original sample data?") && reset()} className="ml-auto rounded border border-amber-300 bg-white px-2 py-0.5 font-medium text-amber-700 hover:bg-amber-100">Reset sample</button>
      </div>

      {/* sub-nav */}
      <div className="overflow-x-auto">
        <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`whitespace-nowrap px-4 py-2 text-sm font-medium transition-colors ${tab === t.id ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "home" && <Home onOpenInvestor={open} goto={setTab} />}
      {tab === "investors" && <Investors live={live} onOpenInvestor={open} />}
      {tab === "contacts" && <Contacts onOpenInvestor={open} />}
      {tab === "activity" && <Activity onOpenInvestor={open} />}
      {tab === "tasks" && <Tasks onOpenInvestor={open} />}
      {tab === "pipeline" && <Pipeline live={live} onOpenInvestor={open} />}

      {openId && <InvestorDetail investorId={openId} live={live} onClose={() => setOpenId(null)} />}
    </div>
  );
}

export default function Crm({ live }: { live: Record<string, LivePosition> }) {
  return (
    <CrmProvider>
      <CrmInner live={live} />
    </CrmProvider>
  );
}
