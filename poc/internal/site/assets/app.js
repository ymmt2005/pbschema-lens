const app = document.querySelector("#app");
if (!app) {
    throw new Error("missing #app");
}
const baseHref = document.querySelector("base")?.getAttribute("href") ?? "/";
const baseURL = new URL(baseHref, location.origin);
try {
    const schema = await loadSchema();
    render(app, schema, currentPath());
}
catch (error) {
    app.replaceChildren(el("p", error instanceof Error ? error.message : String(error), "error"));
}
async function loadSchema() {
    const response = await fetch(new URL("model.json", baseURL));
    if (!response.ok) {
        throw new Error(`model.json returned ${response.status}`);
    }
    return (await response.json());
}
function currentPath() {
    const prefix = baseURL.pathname.endsWith("/") ? baseURL.pathname.slice(0, -1) : baseURL.pathname;
    let path = location.pathname;
    if (prefix && path.startsWith(prefix)) {
        path = path.slice(prefix.length) || "/";
    }
    if (path.endsWith("/index.html")) {
        path = path.slice(0, -"index.html".length);
    }
    if (!path.endsWith("/")) {
        path += "/";
    }
    return path;
}
function render(root, schema, path) {
    const message = schema.messages.find((item) => item.urlPath === path);
    root.replaceChildren();
    if (message) {
        document.title = `${message.fullName} · ${schema.title}`;
        renderMessage(root, message);
        return;
    }
    document.title = schema.title;
    renderHome(root, schema);
}
function renderHome(root, schema) {
    root.append(el("h1", schema.title));
    root.append(el("p", `${schema.messages.length} messages · ${schema.enums.length} enums · ${schema.services.length} services`, "muted"));
    const byPackage = new Map();
    for (const message of schema.messages) {
        const list = byPackage.get(message.package) ?? [];
        list.push(message);
        byPackage.set(message.package, list);
    }
    root.append(el("h2", "Messages"));
    if (schema.messages.length === 0) {
        root.append(el("p", "No messages in this descriptor set.", "muted"));
    }
    for (const [pkg, messages] of byPackage) {
        root.append(el("h3", pkg));
        const list = document.createElement("ul");
        for (const message of messages) {
            const item = document.createElement("li");
            const link = document.createElement("a");
            link.href = withBase(message.urlPath);
            link.textContent = message.fullName;
            item.append(link);
            list.append(item);
        }
        root.append(list);
    }
    root.append(el("h2", "Enums"));
    const enums = document.createElement("ul");
    for (const item of schema.enums) {
        const li = document.createElement("li");
        li.append(el("code", item.fullName));
        li.append(document.createTextNode(" " + item.values.map((value) => value.name).join(", ")));
        enums.append(li);
    }
    root.append(enums);
    root.append(el("h2", "Services"));
    const services = document.createElement("ul");
    for (const service of schema.services) {
        const li = document.createElement("li");
        li.append(el("code", service.fullName));
        const methods = document.createElement("ul");
        for (const method of service.methods) {
            methods.append(el("li", `${method.name}(${method.input}) returns (${method.output})`));
        }
        li.append(methods);
        services.append(li);
    }
    root.append(services);
}
function renderMessage(root, message) {
    root.append(el("p", null, "muted", (p) => {
        const back = document.createElement("a");
        back.href = withBase("/");
        back.textContent = "All symbols";
        p.append(back);
    }));
    root.append(el("h1", message.fullName));
    root.append(el("p", message.file, "file"));
    const table = document.createElement("table");
    const head = document.createElement("tr");
    for (const label of ["Field", "Number", "Type", "Oneof"]) {
        head.append(el("th", label));
    }
    table.append(head);
    for (const field of message.fields) {
        const row = document.createElement("tr");
        row.append(el("td", null, null, (cell) => cell.append(el("code", field.name))));
        row.append(el("td", String(field.number)));
        row.append(el("td", null, null, (cell) => cell.append(el("code", field.type))));
        row.append(el("td", field.oneof ?? ""));
        table.append(row);
    }
    root.append(table);
}
function withBase(urlPath) {
    const prefix = baseURL.pathname.endsWith("/") ? baseURL.pathname.slice(0, -1) : baseURL.pathname;
    return prefix + (urlPath.startsWith("/") ? urlPath : `/${urlPath}`);
}
function el(tag, text, className, fill) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text) {
        node.textContent = text;
    }
    fill?.(node);
    return node;
}
export {};
