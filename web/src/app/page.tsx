import { Header } from "@/components/landing/Header";
import { Hero } from "@/components/landing/Hero";
import { ComoFunciona } from "@/components/landing/ComoFunciona";
import { PorQue } from "@/components/landing/PorQue";
import { Copa2026 } from "@/components/landing/Copa2026";
import { FAQ } from "@/components/landing/FAQ";
import { FaleConosco } from "@/components/landing/FaleConosco";
import { Footer } from "@/components/landing/Footer";

export default function HomePage() {
  return (
    <>
      <Header />
      <main className="bg-ball">
        <Hero />
        <div className="field-divider" />
        <ComoFunciona />
        <div className="field-divider" />
        <PorQue />
        <div className="field-divider" />
        <Copa2026 />
        <div className="field-divider" />
        <FAQ />
        <div className="field-divider" />
        <FaleConosco />
      </main>
      <Footer />
    </>
  );
}
