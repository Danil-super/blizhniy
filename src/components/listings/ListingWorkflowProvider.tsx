"use client";
import {usePrimaryAccountAuth} from '@/components/auth/AccountAuthProvider';
import {createContext,useContext,type ReactNode} from 'react';
const Context=createContext(false),SimulationContext=createContext(false),WorkActionsContext=createContext(false);
const RenewalContext=createContext(false),ServiceCheckoutContext=createContext(false),SpecialistCheckoutContext=createContext(false);
const DraftRemovalsContext=createContext(false);
export function ListingWorkflowProvider({postmoderation,localSimulation=false,workOwnerActions=false,renewals=false,serviceCheckout=false,specialistCheckout=false,draftRemovals=false,children}:{postmoderation:boolean;localSimulation?:boolean;workOwnerActions?:boolean;renewals?:boolean;serviceCheckout?:boolean;specialistCheckout?:boolean;draftRemovals?:boolean;children:ReactNode}){return <Context.Provider value={postmoderation}><SimulationContext.Provider value={localSimulation}><WorkActionsContext.Provider value={workOwnerActions}><RenewalContext.Provider value={renewals}><ServiceCheckoutContext.Provider value={serviceCheckout}><SpecialistCheckoutContext.Provider value={specialistCheckout}><DraftRemovalsContext.Provider value={draftRemovals}>{children}</DraftRemovalsContext.Provider></SpecialistCheckoutContext.Provider></ServiceCheckoutContext.Provider></RenewalContext.Provider></WorkActionsContext.Provider></SimulationContext.Provider></Context.Provider>;}
export function useListingPostmoderation(){return useContext(Context);}

export function useLocalPaymentSimulation(){return useContext(SimulationContext);}
export function useWorkOwnerActions(){return useContext(WorkActionsContext);}
export function usePlacementRenewals(){
 const enabled=useContext(RenewalContext),simulation=useContext(SimulationContext),account=usePrimaryAccountAuth();
 return enabled&&(simulation||account?.workPublicationTest===true);
}
export function useDraftRemovals(){return useContext(DraftRemovalsContext);}

export function useServiceCheckout(kind?:'marquee'|'fair'|'specialist'){
 const local=useContext(ServiceCheckoutContext),account=usePrimaryAccountAuth();
 return local||kind==='marquee'&&account?.marqueeTest===true;
}

export function useSpecialistCheckout(){const local=useContext(SpecialistCheckoutContext),account=usePrimaryAccountAuth();return local||account?.specialistTest===true;}
