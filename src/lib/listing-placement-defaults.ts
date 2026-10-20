import type {ListingFormSnapshot} from './listing-form-contract';

/** Form values, not a public listing: no publication/payment defaults are invented. */
export function listingPlacementDefaults(snapshot:ListingFormSnapshot){
 const form=snapshot.form;
 return {kind:form.kind,title:form.title,description:form.description,price:form.price??'',
  categorySlug:form.categorySlug??'',subcategoryName:form.subcategoryName??'',city:form.cityName??'',
  address:form.address??'',lat:form.latitude??undefined,lng:form.longitude??undefined,
  hasMapPoint:form.latitude!==null&&form.longitude!==null,showExactAddress:form.showExactAddress,
  phone:form.contactPhone??'',messengerUrl:form.messengerUrl??'',booking:form.booking??undefined};
}
