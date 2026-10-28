"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ArrowUpRight } from "lucide-react";

const contactSchema = z.object({
  name: z.string().trim().min(2, "Please enter at least 2 characters.").max(80, "Please keep your name under 80 characters."),
  email: z.string().trim().email("Enter a valid email address.").max(254, "Email address is too long."),
  subject: z.string().trim().min(3, "Please enter a short subject.").max(120, "Please keep the subject under 120 characters."),
  message: z.string().trim().min(10, "Please add a little more detail (at least 10 characters).").max(3000, "Please keep the message under 3,000 characters."),
  consent: z.boolean().refine(Boolean, "Please agree before sending your message."),
});

type ContactDetails = z.infer<typeof contactSchema>;

export default function ContactForm() {
  const [notice, setNotice] = useState("");
  const {
    register, handleSubmit, setError, clearErrors, reset,
    formState: { errors, isSubmitting },
  } = useForm<ContactDetails>({ mode: "onBlur" });

  async function onSubmit(values: ContactDetails) {
    setNotice("");
    const parsed = contactSchema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "name" || field === "email" || field === "subject" || field === "message" || field === "consent") {
          setError(field, { message: issue.message });
        }
      }
      return;
    }
    const wakeTimer = window.setTimeout(
      () => setNotice("Waking up the message service. Your message will be submitted automatically when it is ready."),
      4000,
    );
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(parsed.data),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message = typeof result === "object" && result !== null && "error" in result
          && typeof result.error === "string" ? result.error : "Your message could not be submitted.";
        throw new Error(message);
      }
      reset();
      setNotice("Your message has been received. It will be stored privately for up to 90 days so Morgan can respond.");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "The message service is temporarily unavailable. Please try again later.");
    } finally {
      window.clearTimeout(wakeTimer);
    }
  }

  return (
    <form className="contact-form" onSubmit={handleSubmit(onSubmit)} noValidate aria-labelledby="contact-form-title">
      <div className="contact-form-heading"><span className="card-index">SEND A MESSAGE</span><h2 id="contact-form-title">Tell me what you have in mind.</h2></div>
      <div className="form-field">
        <label htmlFor="contact-name">Your name</label>
        <input id="contact-name" autoComplete="name" maxLength={80} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "contact-name-error" : undefined} {...register("name", { onChange: () => clearErrors("name") })} />
        {errors.name && <span className="field-error" id="contact-name-error">{errors.name.message}</span>}
      </div>
      <div className="form-field">
        <label htmlFor="contact-email">Email address</label>
        <input id="contact-email" type="email" autoComplete="email" maxLength={254} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "contact-email-error" : undefined} {...register("email", { onChange: () => clearErrors("email") })} />
        {errors.email && <span className="field-error" id="contact-email-error">{errors.email.message}</span>}
      </div>
      <div className="form-field">
        <label htmlFor="contact-subject">Subject</label>
        <input id="contact-subject" maxLength={120} aria-invalid={Boolean(errors.subject)} aria-describedby={errors.subject ? "contact-subject-error" : undefined} {...register("subject", { onChange: () => clearErrors("subject") })} />
        {errors.subject && <span className="field-error" id="contact-subject-error">{errors.subject.message}</span>}
      </div>
      <div className="form-field">
        <label htmlFor="contact-message">Message</label>
        <textarea id="contact-message" rows={5} maxLength={3000} aria-invalid={Boolean(errors.message)} aria-describedby={errors.message ? "contact-message-error" : undefined} {...register("message", { onChange: () => clearErrors("message") })} />
        {errors.message && <span className="field-error" id="contact-message-error">{errors.message.message}</span>}
      </div>
      <div className="form-consent">
        <input id="contact-consent" type="checkbox" aria-invalid={Boolean(errors.consent)} aria-describedby={errors.consent ? "contact-consent-error" : undefined} {...register("consent", { onChange: () => clearErrors("consent") })} />
        <label htmlFor="contact-consent">I agree that my message and contact details may be stored privately for up to 90 days so Morgan can respond.</label>
      </div>
      {errors.consent && <span className="field-error" id="contact-consent-error">{errors.consent.message}</span>}
      <button className="button button-primary" type="submit" disabled={isSubmitting}>{isSubmitting ? "Sending securely…" : "Send message"} <ArrowUpRight size={15} aria-hidden="true" /></button>
      <p className="form-privacy">Messages are private to the admin inbox and automatically expire after 90 days.</p>
      {notice && <p className="form-notice" role="status">{notice}</p>}
    </form>
  );
}
