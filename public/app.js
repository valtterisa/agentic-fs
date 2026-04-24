import React, { useMemo, useState } from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";

const defaultHeaders = {
  "content-type": "application/json",
  "x-role": "editor",
  "x-user-id": "demo-user",
  "x-tenant-id": "demo-tenant",
  "x-cwd": "/"
};

function App() {
  const [status, setStatus] = useState("ready");
  const [output, setOutput] = useState("");
  const [role, setRole] = useState("editor");
  const [agentPrompt, setAgentPrompt] = useState("Summarize what is under /kb/docs and write a short note to /workspace/notes/summary.txt");

  const headers = useMemo(() => ({ ...defaultHeaders, "x-role": role }), [role]);

  async function runAgent() {
    setStatus("running agent...");
    try {
      const res = await fetch("/chat/agent", {
        method: "POST",
        headers,
        body: JSON.stringify({ message: agentPrompt })
      });
      const json = await res.json();
      setOutput(JSON.stringify(json, null, 2));
      setStatus(res.ok ? "agent ok" : "agent failed");
    } catch (error) {
      setOutput(String(error));
      setStatus("agent failed");
    }
  }

  return (
    React.createElement("div", { className: "wrap" },
      React.createElement("h1", null, "vfs-demo mini UI"),
      React.createElement("div", { className: "status" }, `Status: ${status}`),
      React.createElement("div", { className: "card", style: { marginBottom: "12px" } },
        React.createElement("h2", null, "Request Role"),
        React.createElement("select", {
          value: role,
          onChange: (e) => setRole(e.target.value)
        },
          React.createElement("option", { value: "admin" }, "admin"),
          React.createElement("option", { value: "editor" }, "editor"),
          React.createElement("option", { value: "viewer" }, "viewer")
        )
      ),
      React.createElement("div", { className: "grid" },
        React.createElement("div", { className: "card full" },
          React.createElement("h2", null, "agent"),
          React.createElement("form", {
            onSubmit: (e) => {
              e.preventDefault();
              void runAgent();
            }
          },
            React.createElement("textarea", {
              value: agentPrompt,
              onChange: (e) => setAgentPrompt(e.target.value)
            }),
            React.createElement("button", { type: "submit" }, "Run agent")
          )
        ),
        React.createElement("div", { className: "card full" },
          React.createElement("h2", null, "Output"),
          React.createElement("pre", null, output || "Run a tool to see response")
        )
      )
    )
  );
}

createRoot(document.getElementById("root")).render(React.createElement(App));
