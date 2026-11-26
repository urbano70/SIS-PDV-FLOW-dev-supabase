import { Calculator } from 'lucide-react';
import './FechaContaBrand.css';

export default function FechaContaBrand() {
  return (
    <span className="fc-brand">
      <Calculator aria-hidden="true" />
      <span>FechaConta<span className="fc-brand-suffix">.app</span></span>
    </span>
  );
}
