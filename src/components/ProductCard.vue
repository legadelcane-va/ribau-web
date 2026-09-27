<template>
  <div class="product-card">
    <div class="image-container">
      <!-- Image Carousel -->
      <div class="carousel">
        <img 
          v-if="currentImage"
          :src="currentImage.thumb"
          :alt="`${product.name} - Image ${currentImageIndex + 1}`"
          loading="lazy"
          @error="handleImageError"
          class="product-image"
          @click.stop="$emit('image-click', currentImage.src)"
        >
        
        <!-- Navigation Arrows (only show if multiple images) -->
        <button 
          v-if="hasMultipleImages"
          class="carousel-btn prev"
          @click.stop="prevImage"
          aria-label="Previous image"
        >
          ‹
        </button>
        <button 
          v-if="hasMultipleImages"
          class="carousel-btn next"
          @click.stop="nextImage"
          aria-label="Next image"
        >
          ›
        </button>

        <!-- Image Dots Indicator -->
        <div v-if="hasMultipleImages" class="carousel-dots">
          <span 
            v-for="(img, index) in availableImages" 
            :key="index"
            :class="['dot', { active: index === currentImageIndex }]"
            @click.stop="goToImage(index)"
          ></span>
        </div>
      </div>

      <!-- Badges -->
      <span v-if="product.featured" class="badge featured">⭐ Featured</span>
      <span v-if="!product.inStock" class="badge out-of-stock">Sold Out</span>
    </div>
    
    <div class="product-info">
      <h3>{{ product.name }}</h3>
      <p class="category">{{ product.category }}</p>
      <p class="description">{{ product.description }}</p>
      <div class="product-footer">
        <span class="price">€{{ product.price.toFixed(2) }}</span>
        <button 
          class="contact-btn"
          :disabled="!product.inStock"
          @click="$emit('contact', product)"
        >
          {{ product.inStock ? 'Richiedi Info' : 'Non Disponibile' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'ProductCard',
  emits: ['contact', 'image-click'],
  props: {
    product: {
      type: Object,
      required: true
    }
  },
  data() {
    return {
      currentImageIndex: 0,
      brokenImages: []
    };
  },
  computed: {
    // Photos listed in /data/images.json: { src: full size photo, thumb: small version for the card }
    availableImages() {
      return this.product.images.filter(img => !this.brokenImages.includes(img.src));
    },
    currentImage() {
      return this.availableImages[this.currentImageIndex];
    },
    hasMultipleImages() {
      return this.availableImages.length > 1;
    }
  },
  methods: {
    handleImageError(event) {
      // Remove failed image from available images (the logo shows if none are left)
      const failed = this.availableImages.find(img => event.target.src.endsWith(img.thumb));

      if (failed) {
        this.brokenImages.push(failed.src);

        // If we removed the current image, adjust index
        if (this.currentImageIndex >= this.availableImages.length) {
          this.currentImageIndex = Math.max(0, this.availableImages.length - 1);
        }
      }
    },
    nextImage() {
      this.currentImageIndex = (this.currentImageIndex + 1) % this.availableImages.length;
    },
    prevImage() {
      this.currentImageIndex = 
        (this.currentImageIndex - 1 + this.availableImages.length) % this.availableImages.length;
    },
    goToImage(index) {
      this.currentImageIndex = index;
    }
  }
};
</script>

<style scoped>
.product-card {
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  overflow: hidden;
  transition: transform 0.3s ease, box-shadow 0.3s ease;
  display: flex;
  flex-direction: column;
}

.product-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
}

.image-container {
  position: relative;
  width: 100%;
  height: 250px;
  background: #f8f9fa;
}

.carousel {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  /* Logo shown while the photo loads, or if the product has no photo */
  background: url('/images/logos/LNDC-Varese_210x240.webp') center / auto 70% no-repeat;
}

.product-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  cursor: zoom-in;
}

.carousel-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(0, 0, 0, 0.5);
  color: white;
  border: none;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  font-size: 24px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.3s ease;
  z-index: 10;
}

.carousel-btn:hover {
  background: rgba(0, 0, 0, 0.7);
}

.carousel-btn.prev {
  left: 10px;
}

.carousel-btn.next {
  right: 10px;
}

.carousel-dots {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 8px;
  z-index: 10;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: background 0.3s ease, transform 0.3s ease;
}

.dot:hover {
  background: rgba(255, 255, 255, 0.8);
  transform: scale(1.2);
}

.dot.active {
  background: white;
  transform: scale(1.3);
}

.badge {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 5px 12px;
  border-radius: 15px;
  font-size: 0.85rem;
  font-weight: bold;
  z-index: 10;
}

.badge.featured {
  background: #f39c12;
  color: white;
}

.badge.out-of-stock {
  background: #e74c3c;
  color: white;
}

.product-info {
  padding: 20px;
  display: flex;
  flex-direction: column;
  flex-grow: 1;
}

.product-info h3 {
  font-size: 1.3rem;
  color: #2c3e50;
  margin-bottom: 5px;
}

.category {
  color: #3498db;
  font-size: 0.9rem;
  font-weight: 600;
  margin-bottom: 10px;
}

.description {
  color: #7f8c8d;
  font-size: 0.95rem;
  line-height: 1.5;
  margin-bottom: 15px;
  min-height: 60px;
}

.product-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: auto;
}

.price {
  font-size: 1.5rem;
  color: #27ae60;
  font-weight: bold;
}

.contact-btn {
  padding: 10px 20px;
  background: #3498db;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1rem;
  transition: background 0.3s ease;
}

.contact-btn:hover:not(:disabled) {
  background: #2980b9;
}

.contact-btn:disabled {
  background: #95a5a6;
  cursor: not-allowed;
}
</style>
