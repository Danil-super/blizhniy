"use client";
import {createContext,useContext,type ReactNode} from 'react';
const Context=createContext(false),SimulationContext=createContext(false),WorkActionsContext=createContext(false);
const RenewalContext=createContext(false),ServiceCheckoutContext=createContext(false);
export function ListingWorkflowProvider({postmoderation,localSimulation=false,workOwnerActions=false,renewals=false,serviceCheckout=false,children}:{postmoderation:boolean;localSimulation?:boolean;workOwnerActions?:boolean;renewals?:boolean;serviceCheckout?:boolean;children:ReactNode}){return <Context.Provider value={postmoderation}><SimulationContext.Provider value={localSimulation}><WorkActionsContext.Provider value={workOwnerActions}><RenewalContext.Provider value={renewals}><ServiceCheckoutContext.Provider value={serviceCheckout}>{children}</ServiceCheckoutContext.Provider></RenewalContext.Provider></WorkActionsContext.Provider></SimulationContext.Provider></Context.Provider>;}
export function useListingPostmoderation(){return useContext(Context);}

export function useLocalPaymentSimulation(){return useContext(SimulationContext);}
export function useWorkOwnerActions(){return useContext(WorkActionsContext);}
export function usePlacementRenewals(){return useContext(RenewalContext);}

export function useServiceCheckout(){return useContext(ServiceCheckoutContext);}
