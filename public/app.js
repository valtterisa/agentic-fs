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
  const [tool, setTool] = useState("ls");
  const [path, setPath] = useState("/");
  const [pattern, setPattern] = useState("vfs");
  const [content, setContent] = useState("hello from vfs");

  const headers = useMemo(() => ({ ...defaultHeaders, "x-role": role }), [role]);

  async function runTool(event) {
    event.preventDefault();
    setStatus(`running ${tool}...`);
    const body = { path };
    if (tool === "write") body.content = content;
    if (tool === "grep") body.pattern = pattern;
    try {
      const res = await fetch(`/tools/${tool}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });
      const json = await res.json();
      setOutput(JSON.stringify(json, null, 2));
      setStatus(res.ok ? `${tool} ok` : `${tool} failed`);
    } catch (error) {
      setOutput(String(error));
      setStatus(`${tool} failed`);
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
          React.createElement("h2", null, "POSIX-like VFS tool"),
          React.createElement("form", {
            onSubmit: (e) => void runTool(e)
          },
            React.createElement("select", {
              value: tool,
              onChange: (e) => setTool(e.target.value)
            },
              React.createElement("option", { value: "ls" }, "ls"),
              React.createElement("option", { value: "cat" }, "cat"),
              React.createElement("option", { value: "write" }, "write"),
              React.createElement("option", { value: "mkdir" }, "mkdir"),
              React.createElement("option", { value: "rm" }, "rm"),
              React.createElement("option", { value: "find" }, "find"),
              React.createElement("option", { value: "grep" }, "grep")
            ),
            React.createElement("input", {
              value: path,
              onChange: (e) => setPath(e.target.value),
              placeholder: "/workspace/notes/hello.txt"
            }),
            tool === "grep" && React.createElement("input", {
              value: pattern,
              onChange: (e) => setPattern(e.target.value),
              placeholder: "pattern"
            }),
            tool === "write" && React.createElement("textarea", {
              value: content,
              onChange: (e) => setContent(e.target.value)
            }),
            React.createElement("button", { type: "submit" }, "Run tool")
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
