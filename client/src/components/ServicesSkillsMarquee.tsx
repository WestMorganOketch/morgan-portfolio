"use client";

import { profile } from "@/data/profile";
import { skillGroups } from "@/data/site";

const capabilityItems = [
  ...profile.services.map((service) => ({
    id: "service-" + service.number,
    label: service.title,
    category: "SERVICE",
    kind: "service" as const,
  })),
  ...skillGroups.flatMap((group) =>
    group.skills.map(([name]) => ({
      id: "skill-" + group.name + "-" + name,
      label: name,
      category: group.name.toUpperCase(),
      kind: "skill" as const,
    })),
  ),
].filter((item, index, all) =>
  all.findIndex((candidate) => candidate.label.toLowerCase() === item.label.toLowerCase()) === index,
);

function CapabilityItems({ duplicate = false }: { duplicate?: boolean }) {
  return (
    <ul
      className="capability-marquee-group"
      aria-hidden={duplicate || undefined}
      aria-label={duplicate ? undefined : "Services and technical skills"}
    >
      {capabilityItems.map((item) => (
        <li
          className="capability-marquee-item"
          data-kind={item.kind}
          key={item.id}
        >
          <span className="capability-marquee-category">{item.category}</span>
          <span className="capability-marquee-label">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ServicesSkillsMarquee() {
  return (
    <section className="capability-marquee" aria-labelledby="capability-marquee-title">
      <div className="capability-marquee-heading">
        <p className="capability-marquee-title" id="capability-marquee-title">
          <span aria-hidden="true">✳</span> SERVICES <i>&amp;</i> SKILLS
        </p>
        <p className="capability-marquee-status">
          <span aria-hidden="true" />
          {capabilityItems.length} DISTINCT CAPABILITIES
        </p>
      </div>
      <div className="capability-marquee-window" role="region" aria-label="Continuously moving services and skills">
        <div className="capability-marquee-track">
          <CapabilityItems />
          <CapabilityItems duplicate />
        </div>
      </div>
    </section>
  );
}
