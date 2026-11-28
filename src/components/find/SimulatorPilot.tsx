import { useAuth } from "../../context/AuthContext";
import {useSimulatorApi} from "../../lib/simulatorApiContext";
import {SimulatorSessions} from "./SimulatorSessions";
import { useState } from "react";
import { ArrowLeft, ArrowUpRight, CalendarDays, Clock3, MapPin, Monitor, Plus, Users, Check } from "lucide-react";
import { simulatorCityForLocation, simulatorVenuesForCity } from "../../data/simulatorVenues";

function SimulatorDemo({ initialHosting = false, onHost, onBack, locationLabel = "New York" }: { initialHosting?: boolean; onHost?: () => void; onBack?: () => void; locationLabel?: string }) {
 const [hosting, setHosting] = useState(initialHosting);
 const city = simulatorCityForLocation(locationLabel);
 const venues = simulatorVenuesForCity(city);
 const [venue, setVenue] = useState<string>(venues[0]?.id ?? "");
 const [saved, setSaved] = useState(false);
 const [confirmed, setConfirmed] = useState(false);
 const current = venues.find(v => v.id === venue) ?? venues[0];
 const field = "mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900";
 if (!current) return <section className="rounded-3xl border border-slate-200 bg-white p-6"><h2 className="text-xl font-bold">Simulators</h2><p className="mt-3 text-sm text-slate-500">No verified simulator venues for {locationLabel || "your selected area"} yet. Change your playing area to explore another city.</p>{onBack && <button onClick={onBack} className={field}>Back</button>}</section>;
 if (hosting) return <section className="space-y-5">
  <button onClick={()=>{if (onBack) { onBack(); return; } setHosting(false);setSaved(false);setConfirmed(false)}} className="flex items-center gap-2 text-sm font-semibold text-fairway-800"><ArrowLeft size={18}/>Simulators</button>
  <div><span className="text-xs font-bold uppercase tracking-widest text-fairway-700">Simulator</span><h2 className="mt-2 text-2xl font-bold text-slate-900">Host a simulator session</h2><p className="mt-2 text-sm text-slate-500">Find your group. Book your bay with the venue.</p></div>
  {saved ? <div role="status" className="rounded-3xl border border-green-200 bg-green-50 p-6"><Check className="mb-3 text-green-700"/><h3 className="font-bold">Preview session created</h3><p className="mt-2 text-sm">This is a local demo only. No session was published, no invitations were sent, and no bay was reserved.</p><button className={field} onClick={()=>{setSaved(false);setConfirmed(false)}}>Create another preview</button></div> : <>
  <p className="text-xs text-slate-500">{locationLabel} · Times at the venue ({current.timezone})</p>
  <form className="space-y-4" onSubmit={e=>{e.preventDefault();setSaved(true)}}>
   <label className="block text-sm font-semibold">Venue<select className={field} value={current.id} onChange={e=>{setVenue(e.target.value);setConfirmed(false)}}>{venues.map(v=><option key={v.id} value={v.id}>{v.name} · {v.area}</option>)}</select></label>
   <p className="flex items-center gap-2 text-xs text-slate-500"><MapPin size={14}/>{current.address}</p>
   <div className="grid grid-cols-2 gap-3"><label className="text-sm font-semibold">Date<input className={field} type="date" required/></label><label className="text-sm font-semibold">Start time<input className={field} type="time" required/></label></div>
   <div className="grid grid-cols-2 gap-3"><label className="text-sm font-semibold">Duration<select className={field}><option>60 minutes</option><option>90 minutes</option><option>120 minutes</option></select></label><label className="text-sm font-semibold">Group size<select className={field}><option>4 golfers</option><option>2 golfers</option><option>3 golfers</option></select></label></div>
   <label className="block text-sm font-semibold">Session vibe<select className={field}><option>Casual virtual round</option><option>Practice together</option><option>Beginner friendly</option></select></label>
   <div className="rounded-2xl bg-amber-50 p-4 text-xs leading-relaxed text-amber-950"><strong>Booking is separate.</strong> GolfMe does not check bay availability or collect payment. Confirm the time, price and booking directly with the venue.<a href={current.url} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-1 font-bold underline">Visit venue website <ArrowUpRight size={14}/></a></div>
   <label className="flex gap-3 text-xs leading-relaxed text-slate-600"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} className="mt-1"/>I understand this creates only a local preview, not a real booking or a public session.</label>
   <button className="w-full rounded-full bg-gradient-to-br from-brand-forest to-brand-forest-deep py-4 font-semibold text-white">Create preview session</button>
  </form></>}
 </section>;
 return <section className="space-y-5">
 <div className="rounded-3xl bg-gradient-to-br from-brand-forest to-brand-forest-deep p-6 text-white">
  <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">Simulator</span>
  <h2 className="mt-4 text-2xl font-bold">Keep your game going.</h2><p className="mt-2 text-sm leading-relaxed text-white/80">Same golf community. A different way to play, whatever the weather.</p>
  <button onClick={()=>onHost ? onHost() : setHosting(true)} className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-white py-3 text-sm font-bold text-brand-forest"><Plus size={18}/>Host a simulator session</button>
 </div>
 <div className="flex items-center justify-between"><h3 className="text-lg font-bold">Simulator sessions</h3><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">Demo preview</span></div>
 <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
  <div className="flex items-center justify-between text-xs"><span className="flex items-center gap-1 rounded-full bg-fairway-50 px-3 py-1 font-semibold text-fairway-800"><Monitor size={13}/>Simulator</span><span className="text-slate-400">Example session</span></div>
  <h3 className="mt-4 text-lg font-bold">After-class swings</h3><p className="mt-1 text-sm font-semibold text-slate-700">{current.name} · {current.area}</p>
  <div className="mt-4 flex gap-5 text-sm text-slate-600"><span className="flex items-center gap-2"><CalendarDays size={16}/>Thu · 6:00 PM</span><span className="flex items-center gap-2"><Clock3 size={16}/>90 min</span></div>
  <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4 text-sm text-fairway-800"><Users size={16}/>Casual virtual round · All levels</div>
  <p className="mt-3 text-xs leading-relaxed text-slate-400">Illustrative only. No real host, open spots or venue availability.</p>
 </article>
 <h3 className="text-lg font-bold">Simulator venues · {locationLabel}</h3>
 {venues.map(v=><a key={v.id} href={v.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4"><span className="rounded-2xl bg-fairway-50 p-3 text-fairway-800"><Monitor size={22}/></span><span className="flex-1"><strong className="block text-sm">{v.name} · {v.area}</strong><span className="mt-1 block text-xs text-slate-500">{v.address}</span></span><ArrowUpRight size={17} className="text-slate-400"/></a>)}
 <p className="text-xs leading-relaxed text-slate-500">Simulator venues only. Bookings and payment stay with the venue. This pilot is local and is not live.</p>
 </section>;
}

export function SimulatorPilot(props:Parameters<typeof SimulatorDemo>[0]) {
 const api=useSimulatorApi();
 const {authUser}=useAuth();
 return api?<SimulatorSessions key={authUser?.id ?? "fixture"} api={api} actorId={authUser?.id} locationLabel={props.locationLabel??'New York'} initialHosting={props.initialHosting}/>:<SimulatorDemo {...props}/>;
}
