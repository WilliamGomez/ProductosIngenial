import { models } from "powerbi-client";
import type { IUser } from "../interfaces/IUser";
import type { AppRole } from "../hooks/useAuth";

export const getFilters = (userData: IUser, product: string, role: AppRole): models.IBasicFilter[] => {
  const filters: models.IBasicFilter[] = [];

  if (role === "Admin") {
    return filters;
  } else {
    const { products } = userData;
    const productData = products.find((p) => p.name === product);

    if (!productData || !productData.state || !productData.city) {
      return filters;
    }

    const states = productData.state;
    const cities = productData.city;

    filters.push({
      $schema: "http://powerbi.com/product/schema#basic",
      target: {
        table: "public data_votacion",
        column: "nom_dep",
      },
      operator: "In",
      filterType: models.FilterType.Basic,
      values: states.split(","),
    });

    filters.push({
      $schema: "http://powerbi.com/product/schema#basic",
      target: {
        table: "public data_votacion",
        column: "nom_mun",
      },
      operator: "In",
      filterType: models.FilterType.Basic,
      values: cities.split(","),
    });
    return filters;
  }
};
