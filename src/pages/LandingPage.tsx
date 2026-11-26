import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowRight, ArrowUpRight, Beer, Check, ChefHat, CircleDollarSign, CookingPot, Hamburger, Layers, Pizza, Printer, ReceiptText, Shapes, Smartphone, UtensilsCrossed } from 'lucide-react';
import salao from '../assets/landing/salao.webp';
import atendimento from '../assets/landing/atendimento.webp';
import pizzaiolo from '../assets/landing/pizzaiolo.webp';
import cozinha from '../assets/landing/cozinha.webp';
import chef from '../assets/landing/chef.webp';
import FechaContaBrand from '../components/FechaContaBrand';
import './LandingPage.css';

const photos = [
  { src: salao, alt: 'Salão de restaurante com mesas postas e iluminação suave' },
  { src: atendimento, alt: 'Garçom servindo um prato à mesa' },
  { src: pizzaiolo, alt: 'Pizzaiolo abrindo a massa de pizza à mão' },
  { src: cozinha, alt: 'Cozinha profissional limpa e organizada, com bancadas de aço inox' },
  { src: chef, alt: 'Chef conferindo a qualidade de um prato com um tablet antes do serviço' },
];

const stages = [
  { id: 'salao', name: 'Salão', icon: Smartphone, heading: 'Mesa 08', item: '1x Porção de Picanha', detail: 'Alho dourado · Cebola grelhada', status: 'Pedido lançado' },
  { id: 'cozinha', name: 'Cozinha', icon: ChefHat, heading: 'Em preparo', item: '1x Porção de Picanha', detail: 'Alho dourado · Cebola grelhada', status: 'Comanda na cozinha' },
  { id: 'caixa', name: 'Caixa', icon: ReceiptText, heading: 'Conta paga', item: 'Total da mesa', detail: 'R$ 78,00 · Pix', status: 'Pagamento registrado' },
];

const features = [
  { icon: Smartphone, title: 'Atendimento à mesa', detail: 'O garçom abre a comanda pelo celular ou tablet. O pedido aparece em tempo real no painel e na cozinha. Pelo QR Code da mesa, o cliente pode conferir o pedido e chamar o garçom sempre que precisar.' },
  { icon: UtensilsCrossed, title: 'Pedido do jeito do cliente', detail: 'Registre sabores, adicionais e outros detalhes no mesmo pedido. A cozinha recebe a combinação escolhida na mesa.' },
  { icon: Printer, title: 'Preparo e impressão', detail: 'A equipe acompanha o preparo no painel da cozinha e recebe as comandas nas impressoras térmicas. Pelo QR Code da mesa, o cliente acompanha cada etapa do pedido.' },
  { icon: Layers, title: 'Cardápio e estoque', detail: 'Organize categorias e produtos no cardápio e consulte o estoque durante o atendimento.' },
  { icon: CircleDollarSign, title: 'Caixa e pagamentos', detail: 'Feche comandas, registre a forma de pagamento e confira as vendas do turno no relatório de caixa.' },
  { icon: Shapes, title: 'Modo Parquinho', detail: 'Vincule a entrada da criança à mesa do responsável e acompanhe o atendimento da área infantil em um terminal próprio.' },
];

const plans = [
  { id: 'free', name: 'Gratuito', price: '0', period: 'para sempre', items: ['Até 10 mesas', '1 usuário admin', 'Cardápio digital', 'App do garçom'], action: 'Começar grátis' },
  { id: 'pro', name: 'Pro', price: '240,79', period: 'por mês', items: ['Mesas ilimitadas', 'Múltiplos garçons', 'Cardápio digital com QR Code nas mesas para autoatendimento', 'App do garçom disponível', 'Modo Parquinho integrado', 'Modo KDS integrado', 'Relatórios avançados', 'Controle de estoque', 'Emissão de NF-e e NFC-e', 'Suporte prioritário'], action: 'Assinar Pro' },
];

function RestaurantGallery() {
  const [slide, setSlide] = useState({ current: 0, previous: -1 });
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer: number;
    function schedule() {
      window.clearInterval(timer);
      if (!document.hidden && !motion.matches) {
        timer = window.setInterval(() => {
          setSlide(({ current }) => ({ previous: current, current: (current + 1) % photos.length }));
        }, 7500);
      }
    }
    schedule();
    motion.addEventListener('change', schedule);
    document.addEventListener('visibilitychange', schedule);
    return () => {
      window.clearInterval(timer);
      motion.removeEventListener('change', schedule);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, []);
  return (
    <div className="fc-gallery" role="group" aria-label="Cenas do restaurante">
      {photos.map(({ src, alt }, i) => (
        <img key={src} src={src} alt={alt} width="1450" height="967"
          className={i === slide.current ? 'current' : i === slide.previous ? 'previous' : undefined}
          aria-hidden={i !== slide.current} fetchPriority={i === 0 ? 'high' : 'auto'} />
      ))}
    </div>
  );
}

function OrderPreview() {
  const [selected, setSelected] = useState(0);
  return (
    <figure className="fc-preview" id="demonstracao" aria-label="Demonstração de um pedido">
      <div className="fc-photo">
        <RestaurantGallery />
        <div className="fc-shot-label"><span /> Pedido de exemplo</div>
      </div>
      <div className="fc-ticket-stack" aria-live="polite" aria-atomic="true">
        {stages.map((stage, index) => (
          <div key={stage.id} className="fc-ticket" id={'fc-ticket-' + stage.id}
            data-stage={selected === index ? stage.id : undefined} aria-hidden={selected !== index}>
            <div className="fc-ticket-meta"><ReceiptText size={15} aria-hidden="true" /> COMANDA · 018</div>
            <strong>{stage.heading}</strong>
            <b>{stage.item}</b><small>{stage.detail}</small>
            <div className="fc-ticket-status"><Check size={13} aria-hidden="true" />{stage.status}</div>
          </div>
        ))}
      </div>
      <figcaption>
        <span className="fc-demo-label">Explore o pedido</span>
        <div role="group" aria-label="Etapa do pedido" className="fc-stages">
          {stages.map(({ id, name, icon: Icon }, index) => (
            <button key={name} type="button" aria-controls={'fc-ticket-' + id} aria-pressed={selected === index} onClick={() => setSelected(index)}>
              <Icon size={15} aria-hidden="true" />{name}
            </button>
          ))}
        </div>
      </figcaption>
    </figure>
  );
}

export default function LandingPage({ ownerUser }: { ownerUser?: unknown }) {
  const landing = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!landing.current || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }
      }
    }, { threshold: 0.6 });
    const targets = landing.current.querySelectorAll(
      '.fc-industry-list, .fc-order-route, .fc-feature-list .lucide-smartphone, .fc-feature-list .lucide-printer'
    );
    targets.forEach(target => observer.observe(target));
    return () => observer.disconnect();
  }, []);
  const access = ownerUser ? '/portal' : '/login';
  return (
    <div ref={landing} className="fc-landing" id="inicio">
      <a className="fc-skip" href="#conteudo">Pular para o conteúdo</a>
      <header className="fc-header fc-wrap">
        <a href="#conteudo" aria-label="FechaConta, início"><FechaContaBrand /></a>
        <nav aria-label="Navegação principal">
          <a href="#recursos">Recursos</a><a href="#planos">Planos</a>
        </nav>
        <Link className="fc-enter" to={access}>{ownerUser ? 'Meu painel' : 'Entrar'} <ArrowUpRight size={15} /></Link>
      </header>
      <main id="conteudo" tabIndex={-1}>
        <section className="fc-hero fc-wrap" aria-labelledby="fc-title">
          <div className="fc-intro">
            <p className="fc-kicker"><span /> Gestão para food service</p>
            <h1 id="fc-title">Casa cheia.<br />Operação<br /><em>no ponto.</em></h1>
            <p className="fc-lead">Do pedido no celular do garçom ao fechamento do caixa. Mesas, cozinha e pagamentos no mesmo PDV, em tempo real.</p>
            <div className="fc-actions">
              <Link className="fc-button fc-primary" to={ownerUser ? '/portal' : '/login?plan=free'}>{ownerUser ? 'Acessar meu painel' : 'Começar grátis'} <ArrowUpRight size={18} /></Link>
              <a className="fc-text-link" href="#recursos">Ver recursos <ArrowDown size={15} /></a>
            </div>
          </div>
          <OrderPreview />
        </section>
        <div className="fc-industries">
          <div className="fc-wrap fc-industry-list">
            <span><UtensilsCrossed />Restaurantes</span><span><Pizza />Pizzarias</span>
            <span><Beer />Bares</span><span><Hamburger />Lanchonetes</span>
          </div>
        </div>
        <section className="fc-resources" id="recursos" aria-labelledby="fc-res-title">
          <div className="fc-wrap fc-resource-grid">
            <div className="fc-section-intro">
              <p className="fc-kicker"><span /> Recursos do PDV</p>
              <h2 id="fc-res-title">O turno<br />por inteiro.</h2>
              <p>Gerencie seu estabelecimento pela internet, com a identidade da sua casa e os dados de cada operação separados.</p>
              <ol className="fc-order-route" aria-label="Caminho do pedido">
                {stages.map(({ name, icon }, index) => {
                  const Icon = index === 1 ? CookingPot : icon;
                  return (
                    <li key={name} style={{ '--step': index } as CSSProperties}>
                      <span className="fc-stop"><Icon size={15} aria-hidden="true" /></span><span>{name}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
            <div className="fc-feature-list">
              {features.map(({ icon: Icon, title, detail }) => (
                <article key={title}><Icon size={25} aria-hidden="true" /><div><h3>{title}</h3><p>{detail}</p></div></article>
              ))}
            </div>
          </div>
        </section>
        <section className="fc-plans fc-wrap" id="planos" aria-labelledby="fc-plan-title">
          <p className="fc-kicker"><span /> Planos FechaConta</p>
          <h2 id="fc-plan-title">Escolha seu plano.</h2>
          <div className="fc-plan-grid">
            {plans.map(plan => (
              <article className={'fc-plan fc-plan-' + plan.id} key={plan.id}>
                <h3>{plan.name}</h3>
                <p className="fc-price"><span>R$</span> <strong>{plan.price}</strong> <small>{plan.period}</small></p>
                <ul>{plan.items.map(item => <li key={item}><Check size={16} aria-hidden="true" />{item}</li>)}</ul>
                {plan.id === 'pro' && (
                  <section className="fc-business-module" aria-labelledby="fc-business-title">
                    <h4 id="fc-business-title">Gestor empresarial</h4>
                    <ul>
                      <li>Checklist de estoque</li>
                      <li>Check-in de departamento</li>
                      <li>Gestão do registro de ponto dos colaboradores</li>
                      <li>Gestão de pagamentos e descontos dos colaboradores</li>
                      <li>Gestor de etiquetas</li>
                    </ul>
                  </section>
                )}
                <Link className={'fc-button ' + (plan.id === 'pro' ? 'fc-primary' : 'fc-secondary')} to={ownerUser ? '/portal' : '/login?plan=' + plan.id}>
                  {ownerUser ? 'Acessar meu painel' : plan.action}<ArrowRight size={17} />
                </Link>
              </article>
            ))}
          </div>
        </section>
      </main>
      <footer className="fc-footer fc-wrap"><FechaContaBrand /><p>© {new Date().getFullYear()} FechaConta</p><a href="#conteudo">Voltar ao início ↑</a></footer>
    </div>
  );
}
