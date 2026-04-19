import {
	describeTargetFeatures,
	featureFlagLabel,
	resolveBaseUrlMode,
} from "../../ui-shared/src/devkit.js";
import { devkitTarget } from "./generated/devkit-target.js";

const app = document.querySelector("#app");
const featureRows = describeTargetFeatures(devkitTarget.features)
	.map(
		(feature) =>
			`<li><span>${feature.label}</span><strong>${featureFlagLabel(feature.enabled)}</strong></li>`,
	)
	.join("");

app.innerHTML = `
  <main class="shell">
    <section class="hero">
      <p class="eyebrow">DevKit Minimal Scaffold</p>
      <h1>{{PROJECT_NAME}}</h1>
      <p class="lede">A small target-aware app shell generated from the minimal template.</p>
    </section>
    <section class="panel">
      <h2>Target</h2>
      <div class="kv"><span>Name</span><strong>${devkitTarget.name}</strong></div>
      <div class="kv"><span>Description</span><strong>${devkitTarget.description}</strong></div>
      <div class="kv"><span>Base path mode</span><strong>${resolveBaseUrlMode(devkitTarget.features)}</strong></div>
    </section>
    <section class="panel">
      <h2>Feature Flags</h2>
      <ul class="flags">${featureRows}</ul>
    </section>
    <section class="panel muted">
      <h2>Generated Assets</h2>
      <p>The scaffold includes:</p>
      <ul>
        <li>target files from <code>{{TARGET_NAME}}</code></li>
        <li>a copied canonical <code>ui-shared</code> package</li>
        <li>generated target metadata in <code>src/generated/devkit-target.js</code></li>
      </ul>
    </section>
  </main>
`;
